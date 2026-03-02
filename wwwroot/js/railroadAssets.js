window.railroadAssets = {
    scene: null,
    blueprints: {},

    init: function (scene) {
        this.scene = scene;
    },

    loadAssets: async function () {
        try {
            const response = await fetch('data/assetBlueprints.json');
            const data = await response.json();
            data.blueprints.forEach(bp => {
                this.blueprints[bp.id] = bp;
            });
            console.log("Railroad blueprints loaded:", Object.keys(this.blueprints));
        } catch (e) {
            console.error("Error loading railroad assets:", e);
        }
    },

    spawnObject: async function (id, position) {
        const bp = this.blueprints[id];
        if (!bp) {
            console.warn(`Blueprint ${id} not found.`);
            return null;
        }

        const rootNode = new BABYLON.TransformNode("obj_" + id, this.scene);
        rootNode.position = position;

        let parts = bp.parts;

        if (bp.recipe) {
            try {
                const response = await fetch(bp.recipe);
                const data = await response.json();
                parts = data.Parts || data.parts;
            } catch (e) {
                console.error("Failed to load recipe JSON", e);
            }
        }

        if (parts) {
            const registry = new Map();
            parts.forEach(p => {
                this.createPart(p, rootNode, registry);
            });
        }

        return rootNode;
    },

    createPart: function (config, root, registry) {
        const id = config.Id || "p_" + Math.random().toString(36).substr(2, 5);
        const shape = (config.Shape || "Box").toLowerCase();

        const parseVec3 = (data, defaultVal = { x: 0, y: 0, z: 0 }) => {
            if (!data) return new BABYLON.Vector3(defaultVal.x, defaultVal.y, defaultVal.z);
            if (Array.isArray(data)) return new BABYLON.Vector3(data[0] ?? defaultVal.x, data[1] ?? defaultVal.y, data[2] ?? defaultVal.z);
            return new BABYLON.Vector3(data.x ?? defaultVal.x, data.y ?? defaultVal.y, data.z ?? defaultVal.z);
        };

        const scale = parseVec3(config.Scale, { x: 1, y: 1, z: 1 });
        const pos = parseVec3(config.Position, { x: 0, y: 0, z: 0 });
        const rot = parseVec3(config.Rotation, { x: 0, y: 0, z: 0 });

        let mesh;
        if (shape === "sphere") mesh = BABYLON.MeshBuilder.CreateSphere(id, { diameter: 1 }, this.scene);
        else if (shape === "cylinder" || shape === "cone") mesh = BABYLON.MeshBuilder.CreateCylinder(id, { diameterTop: shape === "cone" ? 0 : 1, diameterBottom: 1, height: 1 }, this.scene);
        else if (shape === "capsule") mesh = BABYLON.MeshBuilder.CreateCapsule(id, { radius: 0.5, height: 2 }, this.scene);
        else mesh = BABYLON.MeshBuilder.CreateBox(id, { size: 1 }, this.scene);

        mesh.scaling = scale;
        mesh.position = pos;
        mesh.rotation = new BABYLON.Vector3(
            BABYLON.Tools.ToRadians(rot.x),
            BABYLON.Tools.ToRadians(rot.y),
            BABYLON.Tools.ToRadians(rot.z)
        );

        if (config.ParentId && registry.has(config.ParentId)) {
            mesh.parent = registry.get(config.ParentId);
        } else {
            mesh.parent = root;
        }

        const mat = new BABYLON.StandardMaterial("mat_" + id, this.scene);
        if (config.ColorHex) {
            mat.diffuseColor = BABYLON.Color3.FromHexString(config.ColorHex);
        } else {
            mat.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5); // Default grey
        }

        if (config.Material && config.Material.toLowerCase() === "metal") {
            const pbr = new BABYLON.PBRMaterial("pbr_" + id, this.scene);
            pbr.albedoColor = mat.diffuseColor;
            pbr.metallic = 0.8;
            pbr.roughness = 0.3;
            mesh.material = pbr;
        } else if (config.Material && config.Material.toLowerCase() === "glow") {
            mat.emissiveColor = mat.diffuseColor;
        } else {
            mesh.material = mat;
        }

        registry.set(id, mesh);
    }
};
