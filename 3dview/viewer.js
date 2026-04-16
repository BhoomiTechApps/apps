import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { KMZLoader } from 'three/addons/loaders/KMZLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { setupUI } from './ui.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// --- Global Variables (Accessible by all functions) ---
let scene, camera, renderer, labelRenderer, controls;
const modelRefs = { current: null };
const lightRefs = { directional: null };
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

init();

function init() {
    // 1. Core Scene Setup (Must happen first)
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.position.set(10, 10, 10);

    // 2. WebGL Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    // 3. Label Renderer Setup
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    labelRenderer.domElement.style.pointerEvents = 'none'; // Pass clicks through to 3D
    document.body.appendChild(labelRenderer.domElement);

    // 4. Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);

    lightRefs.directional = new THREE.DirectionalLight(0xffffff, 1.2);
    lightRefs.directional.position.set(5, 10, 7.5);
    scene.add(lightRefs.directional);

    // 5. Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // 6. UI Initialization
    setupUI(scene, controls, modelRefs, lightRefs);

    // 7. Event Listeners
    document.getElementById('filePicker').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) loadFile(file);
    });

    window.addEventListener('resize', onWindowResize);
    
    // Double click to add label
    window.addEventListener('dblclick', onMouseDoubleClick);

    animate();
}

// --- Helper Functions ---

function addLabel(text, vector3) {
    const div = document.createElement('div');
    div.className = 'label';
    div.textContent = text;
    
    // Style applied via CSS in index.html, but forced basic style here just in case
    div.style.backgroundColor = 'rgba(0,0,0,0.7)';
    div.style.color = 'white';
    div.style.padding = '5px';
    div.style.border = '1px solid white';

    const label = new CSS2DObject(div);
    label.position.copy(vector3);
    scene.add(label);
}

function onMouseDoubleClick(event) {
    if (!modelRefs.current) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(modelRefs.current, true);

    if (intersects.length > 0) {
        const point = intersects[0].point;
        const name = prompt("Enter label text:");
        if (name) addLabel(name, point);
    }
}

function loadFile(file) {
    const url = URL.createObjectURL(file);
    const loader = file.name.toLowerCase().endsWith('.kmz') ? new KMZLoader() : new ColladaLoader();
    
    document.getElementById('loading').style.display = 'flex';

    loader.load(url, (result) => {
        if (modelRefs.current) scene.remove(modelRefs.current);
        
        modelRefs.current = result.scene || result.library;
        scene.add(modelRefs.current);

        const box = new THREE.Box3().setFromObject(modelRefs.current);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        modelRefs.current.position.sub(center);
        
        const maxDim = Math.max(size.x, size.y, size.z);
        camera.position.set(maxDim, maxDim, maxDim);
        controls.target.set(0,0,0);
        
        document.getElementById('loading').style.display = 'none';
        URL.revokeObjectURL(url);
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    if (labelRenderer) labelRenderer.render(scene, camera);
}