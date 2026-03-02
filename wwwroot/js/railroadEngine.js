window.railroadEngine = {
    canvas: null,
    engine: null,
    scene: null,
    camera: null,
    locoNode: null,
    trackCurve: null,
    trackTangents: null,
    isAnimating: false,
    passengerCars: [],
    selectedCar: null,
    startFrame: 20, // Start align with the station

    init: async function (canvasId) {
        console.log("Railroad Engine Initializing...");
        this.canvas = document.getElementById(canvasId);
        this.engine = new BABYLON.Engine(this.canvas, true);

        this.scene = this.createScene();
        window.railroadAssets.init(this.scene);

        await window.railroadAssets.loadAssets();

        // Initialize loco state (will snap properly to track later, after curve generation)
        this.locoNode = await window.railroadAssets.spawnObject("steam_locomotive", new BABYLON.Vector3(0, 0, 0));

        // Snap Loco to start exactly at the station
        if (this.locoNode) {
            this.updateTrainTransforms(this.startFrame);
        }

        const stationNode = await window.railroadAssets.spawnObject("train_station", new BABYLON.Vector3(0, 0, 12));
        if (stationNode) {
            stationNode.rotation.y = -Math.PI / 2; // Face parallel to the track, spun 180 degrees
        }

        this.engine.runRenderLoop(() => {
            this.scene.render();
        });

        // Picking logic
        this.scene.onPointerDown = (evt, pickResult) => {
            if (pickResult.hit && pickResult.pickedMesh) {
                let node = pickResult.pickedMesh.parent;
                if (node && this.passengerCars.includes(node)) {
                    this.selectCar(node);
                } else {
                    this.selectCar(null); // Deselect if clicking elsewhere
                }
            }
        };

        window.addEventListener("resize", () => {
            if (this.engine) {
                this.engine.resize();
            }
        });
    },

    selectCar: function (node) {
        // Deselect current
        if (this.selectedCar) {
            this.selectedCar.getChildMeshes().forEach(m => m.showBoundingBox = false);
        }

        this.selectedCar = node;

        // Select new
        if (this.selectedCar) {
            this.selectedCar.getChildMeshes().forEach(m => m.showBoundingBox = true);
        }
    },

    createScene: function () {
        const scene = new BABYLON.Scene(this.engine);
        scene.clearColor = new BABYLON.Color4(0.8, 0.7, 0.6, 1); // Sepia tone background

        this.camera = new BABYLON.ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 3, 15, BABYLON.Vector3.Zero(), scene);
        this.camera.attachControl(this.canvas, true);
        this.camera.lowerRadiusLimit = 2;
        this.camera.upperRadiusLimit = 100;

        const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
        light.intensity = 0.8;

        // Ground
        const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 300, height: 300, subdivisions: 4 }, scene);
        const groundMat = new BABYLON.StandardMaterial("groundMat", scene);
        groundMat.diffuseColor = new BABYLON.Color3(0.5, 0.4, 0.3); // Dirty brown color
        ground.material = groundMat;

        // Detailed Oval Track
        const path = [];
        const R = 30; // Curve radius
        const L = 40; // Half-length of straight section
        const res = 40; // Resolution per segment

        // Bottom straight (z=0)
        for (let i = 0; i <= res; i++) path.push(new BABYLON.Vector3(-L + (2 * L * i / res), 0.05, 0));
        // Right curve
        for (let i = 1; i <= res; i++) {
            const theta = -Math.PI / 2 + (Math.PI * i / res);
            path.push(new BABYLON.Vector3(L + R * Math.cos(theta), 0.05, R + R * Math.sin(theta)));
        }
        // Top straight (z=2R)
        for (let i = 1; i <= res; i++) path.push(new BABYLON.Vector3(L - (2 * L * i / res), 0.05, 2 * R));
        // Left curve
        for (let i = 1; i < res; i++) {
            const theta = Math.PI / 2 + (Math.PI * i / res);
            path.push(new BABYLON.Vector3(-L + R * Math.cos(theta), 0.05, R + R * Math.sin(theta)));
        }
        path.push(path[0]); // Close the loop

        const path3d = new BABYLON.Path3D(path);
        this.trackCurve = path3d.getCurve();
        this.trackTangents = path3d.getTangents();
        const binormals = path3d.getBinormals();

        // Rails
        const rail1Path = [];
        const rail2Path = [];
        const railOffset = 0.4;
        for (let i = 0; i < this.trackCurve.length; i++) {
            const pt = this.trackCurve[i];
            const binormal = binormals[i];
            rail1Path.push(pt.add(binormal.scale(railOffset)));
            rail2Path.push(pt.subtract(binormal.scale(railOffset)));
        }

        const railMat = new BABYLON.StandardMaterial("railMat", scene);
        railMat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.2);

        const rail1 = BABYLON.MeshBuilder.CreateTube("rail1", { path: rail1Path, radius: 0.05, updatable: false }, scene);
        rail1.material = railMat;
        const rail2 = BABYLON.MeshBuilder.CreateTube("rail2", { path: rail2Path, radius: 0.05, updatable: false }, scene);
        rail2.material = railMat;

        // Wooden Ties (Instancing)
        const tieMat = new BABYLON.StandardMaterial("tieMat", scene);
        tieMat.diffuseColor = new BABYLON.Color3(0.4, 0.25, 0.15);
        tieMat.roughness = 0.9;
        const tieMesh = BABYLON.MeshBuilder.CreateBox("tieBase", { width: 0.25, height: 0.08, depth: 1.4 }, scene);
        tieMesh.material = tieMat;

        const tieStep = 1.0;
        let distAccum = 0;
        let tieCount = 0;
        for (let i = 0; i < this.trackCurve.length - 1; i++) {
            const dist = BABYLON.Vector3.Distance(this.trackCurve[i], this.trackCurve[i + 1]);
            distAccum += dist;
            while (distAccum > tieStep) {
                const inst = tieMesh.createInstance("tie_" + tieCount++);
                inst.position = this.trackCurve[i].clone();
                inst.position.y = 0.04;
                inst.lookAt(this.trackCurve[i].add(this.trackTangents[i]));
                inst.rotate(BABYLON.Axis.Y, Math.PI / 2, BABYLON.Space.LOCAL);
                distAccum -= tieStep;
            }
        }
        tieMesh.setEnabled(false); // Hide the base tie

        return scene;
    },

    updateTrainTransforms: function (frame) {
        if (!this.trackCurve || this.trackCurve.length === 0) return;
        const maxFrames = this.trackCurve.length - 1;
        const tangents = this.trackTangents;

        // Wrap frame to loop
        frame = frame % (maxFrames + 1);
        if (frame < 0) frame += (maxFrames + 1);

        // Loco
        if (this.locoNode) {
            this.applyTransformToNode(this.locoNode, frame, tangents, maxFrames);
        }

        // Passenger cars
        let accumulatedOffset = 0;
        let previousCarLength = 3.5; // Loco length in frames

        for (let i = 0; i < this.passengerCars.length; i++) {
            let currentCarLength = this.passengerCars[i].carLengthFrames || 3.5;

            // Distance between the center of the previous car and the center of this car
            accumulatedOffset += (previousCarLength / 2) + (currentCarLength / 2);

            let carFrame = frame - accumulatedOffset;

            // Wrap around for the loop
            carFrame = carFrame % (maxFrames + 1);
            if (carFrame < 0) carFrame += (maxFrames + 1);

            this.applyTransformToNode(this.passengerCars[i], carFrame, tangents, maxFrames);

            previousCarLength = currentCarLength;
        }
    },

    applyTransformToNode: function (node, frame, tangents, maxFrames) {
        let f = frame;
        if (f >= maxFrames + 1) f -= (maxFrames + 1);
        if (f <= 0) f += (maxFrames + 1);

        let currentIdx = Math.floor(f);
        if (currentIdx > maxFrames) currentIdx = maxFrames;
        if (currentIdx < 0) currentIdx = 0;

        let nextIdx = Math.ceil(f);
        if (nextIdx > maxFrames) nextIdx = 0;
        if (nextIdx < 0) nextIdx = 0;

        const currentPos = this.trackCurve[currentIdx];
        const nextPos = this.trackCurve[nextIdx] || currentPos;
        const fraction = f - Math.floor(f);

        // Interpolate position
        const interpPos = BABYLON.Vector3.Lerp(currentPos, nextPos, fraction);

        if (interpPos) {
            node.position = interpPos;
            node.position.y = 0.1; // Maintain height
        }

        // Look along tangent
        const tangent = tangents[currentIdx];
        if (tangent) {
            node.lookAt((interpPos || node.position).add(tangent));
        }
    },

    addPassengerCar: async function () {
        console.log("Adding passenger car...");
        const newCar = await window.railroadAssets.spawnObject("passenger_coach", new BABYLON.Vector3(0, 0, 0));
        if (newCar) {
            newCar.carLengthFrames = 3.5;
            this.attachCar(newCar);
        }
    },

    addCoalTender: async function () {
        console.log("Adding coal tender...");
        const newCar = await window.railroadAssets.spawnObject("coal_tender", new BABYLON.Vector3(0, 0, 0));
        if (newCar) {
            newCar.carLengthFrames = 2.0; // Tenders are shorter
            this.attachCar(newCar);
        }
    },

    attachCar: function (newCar) {
        this.passengerCars.push(newCar);
        if (!this.isAnimating) {
            this.updateTrainTransforms(this.startFrame);
        }
    },

    removeSelectedCar: function () {
        if (this.selectedCar) {
            console.log("Removing selected car...");
            const idx = this.passengerCars.indexOf(this.selectedCar);
            if (idx > -1) {
                this.passengerCars.splice(idx, 1);
            }
            this.selectedCar.dispose();
            this.selectedCar = null;

            // Re-evaluate positions so train reorganizes mathematically to fill the gap
            if (!this.isAnimating) {
                this.updateTrainTransforms(this.startFrame);
            }
        }
    },

    startAnimation: function () {
        if (!this.locoNode || !this.trackCurve || this.isAnimating) return;
        this.isAnimating = true;

        let frame = this.startFrame;
        const speed = 0.05; // Adjust speed as necessary
        const maxFrames = this.trackCurve.length - 1;
        const endFrame = this.startFrame + (maxFrames + 1); // One full loop

        const animObserver = this.scene.onBeforeRenderObservable.add(() => {
            if (frame >= endFrame) { // Complete a full loop
                this.scene.onBeforeRenderObservable.remove(animObserver);
                this.isAnimating = false;

                // Snap back to start perfectly
                this.updateTrainTransforms(this.startFrame);
                return;
            }

            this.updateTrainTransforms(frame);
            frame += speed;
        });
    }
};
