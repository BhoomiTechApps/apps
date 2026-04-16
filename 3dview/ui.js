import * as THREE from 'three';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';

export function setupUI(scene, controls, modelRefs, lightRefs) {
    const gui = new GUI({ title: 'Viewer Controls' });
    const loader = new THREE.TextureLoader();

    // Low-resolution texture library (Official Three.js public assets)
    const texturePaths = {
        wood: 'https://threejs.org/examples/textures/hardwood2_diffuse.jpg',
        stone: 'https://threejs.org/examples/textures/floors/FloorsCheckerboard_S_Diffuse.jpg',
        metal: 'https://threejs.org/examples/textures/cube/skybox/px.jpg'
    };

    const settings = {
        wireframe: false,
        opacity: 1.0,
        bgColor: '#111111',
        intensity: 1.2,
        lightX: 5,
        lightY: 10,
        materialPreset: 'Original',
        tintColor: '#ffffff'
    };

    // --- Helper Function: Apply Material ---
    function applyMaterial(texUrl, roughness, metalness) {
        if (!modelRefs.current) return;

        let texture = null;
        if (texUrl) {
            texture = loader.load(texUrl);
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(2, 2); // Tiles the low-res image so it stays sharp
        }

        modelRefs.current.traverse(child => {
            if (child.isMesh) {
                // We create a new Standard Material to support PBR (Metal/Roughness)
                child.material = new THREE.MeshStandardMaterial({
                    map: texture,
                    roughness: roughness,
                    metalness: metalness,
                    color: settings.tintColor,
                    transparent: settings.opacity < 1.0,
                    opacity: settings.opacity,
                    wireframe: settings.wireframe
                });
            }
        });
    }

    // --- Visual Style Folder ---
    const styleFolder = gui.addFolder('Visual Style');
    
    styleFolder.add(settings, 'wireframe').name('Wireframe Mode').onChange(val => {
        if (modelRefs.current) {
            modelRefs.current.traverse(child => {
                if (child.isMesh) child.material.wireframe = val;
            });
        }
    });

    styleFolder.add(settings, 'opacity', 0, 1).name('X-Ray (Opacity)').onChange(val => {
        if (modelRefs.current) {
            modelRefs.current.traverse(child => {
                if (child.isMesh) {
                    child.material.transparent = true;
                    child.material.opacity = val;
                }
            });
        }
    });

    // --- Material Presets Folder ---
    const matFolder = gui.addFolder('Material Presets');

    const presets = {
        'Original': () => { location.reload(); }, // Simplest way to revert
        'Wood': () => applyMaterial(texturePaths.wood, 0.5, 0.0),
        'Stone': () => applyMaterial(texturePaths.stone, 0.8, 0.0),
        'Metal': () => applyMaterial(null, 0.2, 1.0),
        'Glass': () => applyMaterial(null, 0.1, 0.0)
    };

    matFolder.add(settings, 'materialPreset', Object.keys(presets)).name('Select Style').onChange(key => {
        presets[key]();
    });

    matFolder.addColor(settings, 'tintColor').name('Texture Tint').onChange(val => {
        if (modelRefs.current) {
            modelRefs.current.traverse(child => {
                if (child.isMesh) child.material.color.set(val);
            });
        }
    });

    // --- Environment Folder ---
    const envFolder = gui.addFolder('Environment');
    
    envFolder.addColor(settings, 'bgColor').name('Background').onChange(val => {
        scene.background.set(val);
    });

    envFolder.add(settings, 'intensity', 0, 4).name('Light Intensity').onChange(val => {
        lightRefs.directional.intensity = val;
    });

    envFolder.add(settings, 'lightX', -20, 20).name('Light Dir X').onChange(val => {
        lightRefs.directional.position.x = val;
    });

    envFolder.add(settings, 'lightY', -20, 20).name('Light Dir Y').onChange(val => {
        lightRefs.directional.position.y = val;
    });

    styleFolder.open();
    matFolder.open();
    envFolder.open();
}