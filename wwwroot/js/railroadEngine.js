window.railroadEngine = {
    canvas: null,
    engine: null,
    scene: null,
    camera: null,
    locoNode: null,
    trackCurve: null,
    trackTangents: null,
    entryCurve: null,
    entryTangents: null,
    departCurve: null,
    departTangents: null,
    stationNode: null,
    townLabelUI: null,

    STATE_IDLE: 0,
    STATE_LOOPING: 1,
    STATE_DEPARTING: 2,
    STATE_ARRIVING: 3,
    animState: 0,

    isAnimating: false,
    passengerCars: [],
    selectedCar: null,
    startFrame: 30, // Start align with the station (L=60, res=60 -> center is 30)
    currentTownName: "",

    init: async function (canvasId, initialTownName) {
        console.log("Railroad Engine Initializing...");
        this.canvas = document.getElementById(canvasId);
        this.engine = new BABYLON.Engine(this.canvas, true);
        this.currentTownName = initialTownName || "Sacramento";

        this.scene = this.createScene();
        window.railroadAssets.init(this.scene);

        await window.railroadAssets.loadAssets();

        // Initialize loco state (will snap properly to track later, after curve generation)
        this.locoNode = await window.railroadAssets.spawnObject("steam_locomotive", new BABYLON.Vector3(0, 0, 0));

        // Default train has a caboose at the end
        const cabooseNode = await window.railroadAssets.spawnObject("caboose", new BABYLON.Vector3(0, 0, 0));
        if (cabooseNode) {
            cabooseNode.carLengthFrames = 3.2; // roughly
            cabooseNode.isCaboose = true;
            this.passengerCars.push(cabooseNode);
        }

        // Snap Loco to start exactly at the station
        if (this.locoNode) {
            this.updateTrainTransforms(this.startFrame);
        }

        this.stationNode = await window.railroadAssets.spawnObject("train_station", new BABYLON.Vector3(0, 0, 12));
        if (this.stationNode) {
            this.stationNode.rotation.y = -Math.PI / 2; // Face parallel to the track, spun 180 degrees
            this.createStationText(this.currentTownName);
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

    createStationText: function (name) {
        if (!this.stationNode) return;

        const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI");

        const rect1 = new BABYLON.GUI.Rectangle();
        rect1.width = "250px";
        rect1.height = "60px";
        rect1.color = "#4a3b2c";
        rect1.thickness = 4;
        rect1.background = "#dfd2a5";
        advancedTexture.addControl(rect1);

        const text1 = new BABYLON.GUI.TextBlock();
        text1.text = name;
        text1.color = "#4a3b2c";
        text1.fontFamily = "Times New Roman";
        text1.fontSize = 24;
        text1.fontWeight = "bold";
        rect1.addControl(text1);

        this.townLabelUI = text1;

        rect1.linkWithMesh(this.stationNode);
        rect1.linkOffsetY = -150; // Offset above the station
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
        this.camera.upperRadiusLimit = 200;

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
        const L = 60; // Half-length of straight section
        const res = 60; // Resolution per segment
        this.straightRes = res;

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

        const tieMat = new BABYLON.StandardMaterial("tieMat", scene);
        tieMat.diffuseColor = new BABYLON.Color3(0.4, 0.25, 0.15);
        tieMat.roughness = 0.9;
        const tieMesh = BABYLON.MeshBuilder.CreateBox("tieBase", { width: 0.25, height: 0.08, depth: 1.4 }, scene);
        tieMesh.material = tieMat;

        const mainTrackData = this.renderTrackGeometry(path, scene, tieMesh);
        if (mainTrackData) {
            this.trackCurve = mainTrackData.curve;
            this.trackTangents = mainTrackData.tangents;
        }

        // Entry Track (-x side, arriving from west straight to bottom track)
        const entryPath = [];
        for (let i = 60; i >= 0; i--) entryPath.push(new BABYLON.Vector3(-L - (i * 2), 0.05, 0));

        const entryTrackData = this.renderTrackGeometry(entryPath, scene, tieMesh);
        if (entryTrackData) {
            this.entryCurve = entryTrackData.curve;
            this.entryTangents = entryTrackData.tangents;
        }

        // Departure Track (+x side, departing east straight from bottom track)
        const departPath = [];
        for (let i = 0; i <= 60; i++) departPath.push(new BABYLON.Vector3(L + (i * 2), 0.05, 0));

        const departTrackData = this.renderTrackGeometry(departPath, scene, tieMesh);
        if (departTrackData) {
            this.departCurve = departTrackData.curve;
            this.departTangents = departTrackData.tangents;
        }

        tieMesh.setEnabled(false); // Hide the base tie

        return scene;
    },

    renderTrackGeometry: function (pathArray, scene, tieMesh) {
        if (!pathArray || pathArray.length < 2) return null;
        const path3d = new BABYLON.Path3D(pathArray);
        const curve = path3d.getCurve();
        const binormals = path3d.getBinormals();
        const tangents = path3d.getTangents();

        const rail1Path = [];
        const rail2Path = [];
        const railOffset = 0.4;
        for (let i = 0; i < curve.length; i++) {
            const pt = curve[i];
            const binormal = binormals[i];
            rail1Path.push(pt.add(binormal.scale(railOffset)));
            rail2Path.push(pt.subtract(binormal.scale(railOffset)));
        }

        const railMat = scene.getMaterialByName("railMat") || new BABYLON.StandardMaterial("railMat", scene);
        railMat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.2);

        const rail1 = BABYLON.MeshBuilder.CreateTube("rail1_" + Math.random(), { path: rail1Path, radius: 0.05, updatable: false }, scene);
        rail1.material = railMat;
        const rail2 = BABYLON.MeshBuilder.CreateTube("rail2_" + Math.random(), { path: rail2Path, radius: 0.05, updatable: false }, scene);
        rail2.material = railMat;

        let distAccum = 0;
        const tieStep = 1.0;
        for (let i = 0; i < curve.length - 1; i++) {
            const dist = BABYLON.Vector3.Distance(curve[i], curve[i + 1]);
            distAccum += dist;
            while (distAccum > tieStep) {
                const inst = tieMesh.createInstance("tie_" + Math.random());
                inst.position = curve[i].clone();
                inst.position.y = 0.04;
                inst.lookAt(curve[i].add(tangents[i]));
                inst.rotate(BABYLON.Axis.Y, Math.PI / 2, BABYLON.Space.LOCAL);
                distAccum -= tieStep;
            }
        }
        return { curve, tangents };
    },

    updateTrainTransforms: function (frame) {
        if (!this.trackCurve || this.trackCurve.length === 0) return;

        // Loco
        if (this.locoNode) {
            this.applyTransformToNode(this.locoNode, frame);
        }

        // Passenger cars
        let accumulatedOffset = 0;
        let previousCarLength = 3.5; // Loco length in frames

        for (let i = 0; i < this.passengerCars.length; i++) {
            let currentCarLength = this.passengerCars[i].carLengthFrames || 3.5;

            // Distance between the center of the previous car and the center of this car
            accumulatedOffset += (previousCarLength / 2) + (currentCarLength / 2);

            let carFrame = frame - accumulatedOffset;
            this.applyTransformToNode(this.passengerCars[i], carFrame);

            previousCarLength = currentCarLength;
        }
    },

    applyTransformToNode: function (node, f) {
        const data = this.getCurveData(f);
        const curve = data.curve;
        const tangents = data.tangents;
        const p = data.p;
        const maxFrames = curve.length - 1;

        let currentIdx = Math.floor(p);
        if (currentIdx > maxFrames) currentIdx = maxFrames;
        if (currentIdx < 0) currentIdx = 0;

        let nextIdx = Math.ceil(p);
        if (nextIdx > maxFrames) {
            nextIdx = data.isWrapped ? 0 : maxFrames;
        }
        if (nextIdx < 0) nextIdx = 0;

        const currentPos = curve[currentIdx];
        const nextPos = curve[nextIdx] || currentPos;
        const fraction = p - Math.floor(p);

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

    addOilTankCar: async function () {
        console.log("Adding oil tank car...");
        const newCar = await window.railroadAssets.spawnObject("oil_tank_car", new BABYLON.Vector3(0, 0, 0));
        if (newCar) {
            newCar.carLengthFrames = 3.5;
            this.attachCar(newCar);
        }
    },

    addFreightBoxcar: async function () {
        console.log("Adding freight boxcar...");
        const newCar = await window.railroadAssets.spawnObject("freight_boxcar", new BABYLON.Vector3(0, 0, 0));
        if (newCar) {
            newCar.carLengthFrames = 3.5;
            this.attachCar(newCar);
        }
    },

    attachCar: function (newCar) {
        // All added cars should be in front of the caboose
        if (this.passengerCars.length > 0 && this.passengerCars[this.passengerCars.length - 1].isCaboose) {
            this.passengerCars.splice(this.passengerCars.length - 1, 0, newCar);
        } else {
            this.passengerCars.push(newCar);
        }

        if (!this.isAnimating) {
            this.updateTrainTransforms(this.startFrame);
        }
    },

    removeSelectedCar: function () {
        if (this.selectedCar) {
            if (this.selectedCar.isCaboose) {
                console.log("Cannot remove the caboose!");
                return;
            }

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

    getCurveData: function (f) {
        let curve = this.trackCurve;
        let tangents = this.trackTangents;
        let p = f;
        let isWrapped = true;
        let maxTrack = this.trackCurve.length - 1;

        if (this.animState === this.STATE_DEPARTING) {
            // We want it to drive straight out starting after the straightaway.
            if (f > this.straightRes) {
                curve = this.departCurve;
                tangents = this.departTangents;
                p = f - this.straightRes;
                isWrapped = false;
            } else {
                p = f % (maxTrack + 1);
                if (p < 0) p += maxTrack + 1;
            }
        }
        else if (this.animState === this.STATE_ARRIVING) {
            let entryLen = this.entryCurve.length - 1;
            if (f <= entryLen) {
                curve = this.entryCurve;
                tangents = this.entryTangents;
                p = f;
                isWrapped = false;
            } else {
                curve = this.trackCurve;
                tangents = this.trackTangents;
                p = f - entryLen;

                isWrapped = false;
            }
        }
        else {
            p = f % (maxTrack + 1);
            if (p < 0) p += maxTrack + 1;
        }

        return { curve, tangents, p, isWrapped };
    },
    startAnimation: function () {
        if (!this.locoNode || !this.trackCurve || this.isAnimating) return;
        this.isAnimating = true;
        this.animState = this.STATE_LOOPING;

        let frame = this.startFrame;
        const speed = 0.05; // Adjust speed as necessary
        const maxFrames = this.trackCurve.length - 1;
        const endFrame = this.startFrame + (maxFrames + 1); // One full loop

        this.currentAnimObserver = this.scene.onBeforeRenderObservable.add(() => {
            if (frame >= endFrame) { // Complete a full loop
                this.scene.onBeforeRenderObservable.remove(this.currentAnimObserver);
                this.isAnimating = false;
                this.animState = this.STATE_IDLE;
                // Snap back to start perfectly
                this.updateTrainTransforms(this.startFrame);
                return;
            }

            this.updateTrainTransforms(frame);
            frame += speed;
        });
    },

    beginTravel: function (townName) {
        if (!this.locoNode || !this.trackCurve) return;

        // If it was already moving, hijack it
        if (this.isAnimating && this.currentAnimObserver) {
            this.scene.onBeforeRenderObservable.remove(this.currentAnimObserver);
        }
        this.isAnimating = true;
        this.animState = this.STATE_DEPARTING;

        let frame = this.startFrame;
        const speed = 0.05;
        // Trigger the transition BEFORE we run out of new geometry so the train doesn't park before cutting!
        const departEndFrame = this.straightRes + 50;

        this.currentAnimObserver = this.scene.onBeforeRenderObservable.add(() => {
            this.updateTrainTransforms(frame);
            frame += speed;

            if (frame >= departEndFrame) {
                this.scene.onBeforeRenderObservable.remove(this.currentAnimObserver);
                this.createTransitionScreen(townName, () => {
                    this.currentTownName = townName;
                    if (this.townLabelUI) {
                        this.townLabelUI.text = this.currentTownName;
                    }
                    this.beginArrival();
                });
            }
        });
    },

    beginArrival: function () {
        const groundMat = this.scene.getMaterialByName("groundMat");
        if (groundMat) {
            // Randomize ground to simulate new town biome
            groundMat.diffuseColor = new BABYLON.Color3(Math.random() * 0.5 + 0.3, Math.random() * 0.5 + 0.3, Math.random() * 0.5 + 0.2);
        }

        this.animState = this.STATE_ARRIVING;
        let frame = 0;
        const entryLen = this.entryCurve.length - 1;
        const arriveEndFrame = entryLen + this.startFrame; // Stop exactly at start frame
        const speed = 0.05;

        // Force initial update before animation visually kicks in 
        this.updateTrainTransforms(0);

        this.currentAnimObserver = this.scene.onBeforeRenderObservable.add(() => {
            this.updateTrainTransforms(frame);
            frame += speed;

            if (frame >= arriveEndFrame) {
                this.scene.onBeforeRenderObservable.remove(this.currentAnimObserver);
                this.isAnimating = false;
                this.animState = this.STATE_IDLE;
                this.updateTrainTransforms(this.startFrame);
            }
        });
    },

    createTransitionScreen: function (townName, onComplete) {
        let overlay = document.createElement("div");
        overlay.style.position = "absolute";
        overlay.style.top = "0";
        overlay.style.left = "0";
        overlay.style.width = "100%";
        overlay.style.height = "100%";
        overlay.style.backgroundColor = "black";
        overlay.style.color = "white";
        overlay.style.display = "flex";
        overlay.style.flexDirection = "column";
        overlay.style.justifyContent = "center";
        overlay.style.alignItems = "center";
        overlay.style.zIndex = "999";
        overlay.style.opacity = "0";
        overlay.style.transition = "opacity 1s ease";
        overlay.innerHTML = `<h1 style="font-family: 'Times New Roman', serif; margin-bottom: 20px;">Traveling to ${townName}...</h1>`;
        document.body.appendChild(overlay);

        setTimeout(() => {
            overlay.style.opacity = "1";
            setTimeout(() => {
                onComplete();
                overlay.style.opacity = "0";
                setTimeout(() => { document.body.removeChild(overlay); }, 1000);
            }, 2500);
        }, 100);
    }
};
