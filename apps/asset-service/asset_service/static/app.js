import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = (id) => document.getElementById(id);
const input = $('image-input');
const submit = $('submit');
let selectedFile = null;
let currentModel = null;
let activeAsset = null;
const apiKey = $('api-key');
apiKey.value = sessionStorage.getItem('asset-api-key') || '';
apiKey.addEventListener('input', () => sessionStorage.setItem('asset-api-key', apiKey.value));
const headers = () => apiKey.value ? { 'X-API-Key': apiKey.value } : {};

async function response(result) {
  const body = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(body.detail || `请求失败 (${result.status})`);
  return body;
}

async function health() {
  try {
    const data = await response(await fetch('/api/v1/health'));
    $('health-dot').classList.add('ok');
    $('backend-label').textContent = data.backend === 'hunyuan' ? 'Hunyuan 真实生成' : '本地演示模式';
    $('notice').textContent = data.real_generation
      ? '当前使用 Hunyuan3D 真实照片生成。首次请求会加载模型，耗时较长。'
      : '当前为 demo：返回团队固定花瓶示例，用于验证流程，不是输入照片的真实重建。';
    $('notice').classList.toggle('demo', !data.real_generation);
  } catch (error) {
    $('backend-label').textContent = '服务不可用';
    $('notice').textContent = error.message;
  }
}

function choose(file) {
  if (!file) return;
  selectedFile = file;
  submit.disabled = false;
  $('image-preview').src = URL.createObjectURL(file);
  $('image-preview').hidden = false;
  $('preview-empty').hidden = true;
  $('job-status').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
}
input.addEventListener('change', () => choose(input.files[0]));
const drop = $('drop-zone');
['dragenter', 'dragover'].forEach((event) => drop.addEventListener(event, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach((event) => drop.addEventListener(event, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', (event) => choose(event.dataTransfer.files[0]));

function setStep(status) {
  const order = ['queued', 'running', 'succeeded'];
  const current = order.indexOf(status);
  document.querySelectorAll('.steps div').forEach((element) => {
    element.classList.toggle('active', order.indexOf(element.dataset.step) <= current);
  });
}

async function poll(id) {
  const { job } = await response(await fetch(`/api/v1/jobs/${id}`, { headers: headers() }));
  setStep(job.status);
  if (job.status === 'succeeded') {
    submit.disabled = false;
    submit.innerHTML = '生成新资产 <span>→</span>';
    $('job-status').textContent = `完成 · ${(job.result.duration_ms / 1000).toFixed(1)} 秒`;
    await showAsset(job.result);
    return;
  }
  if (job.status === 'failed') {
    submit.disabled = false;
    $('job-error').textContent = job.error?.message || '生成失败';
    $('job-status').textContent = `失败 · ${job.error?.code || 'UNKNOWN'}`;
    return;
  }
  $('job-status').textContent = job.status === 'running' ? '正在生成几何与贴图，请保持页面打开…' : '任务已进入队列…';
  setTimeout(() => poll(id).catch(showError), 1500);
}

function showError(error) {
  submit.disabled = false;
  $('job-error').textContent = error.message;
}

submit.addEventListener('click', async () => {
  if (!selectedFile) return;
  submit.disabled = true;
  $('job-error').textContent = '';
  setStep('queued');
  const form = new FormData();
  form.append('file', selectedFile);
  form.append('name', $('asset-name').value);
  const requestHeaders = { ...headers(), 'Idempotency-Key': crypto.randomUUID() };
  try {
    const data = await response(await fetch('/api/v1/jobs', { method: 'POST', headers: requestHeaders, body: form }));
    $('job-status').textContent = `任务 ${data.job.id}`;
    await poll(data.job.id);
  } catch (error) { showError(error); }
});

const viewer = $('viewer');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewer.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x72796d, 2.5));
const keyLight = new THREE.DirectionalLight(0xffffff, 3);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);
const grid = new THREE.GridHelper(10, 20, 0xc8cdc3, 0xe0e3dc);
scene.add(grid);

function resize() {
  const width = viewer.clientWidth;
  const height = viewer.clientHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewer);
resize();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

async function showAsset(asset) {
  activeAsset = asset;
  const result = await fetch(asset.model_url, { headers: headers() });
  if (!result.ok) throw new Error('GLB 下载失败');
  const blobUrl = URL.createObjectURL(await result.blob());
  new GLTFLoader().load(blobUrl, (gltf) => {
    URL.revokeObjectURL(blobUrl);
    if (currentModel) scene.remove(currentModel);
    currentModel = gltf.scene;
    scene.add(currentModel);
    const box = new THREE.Box3().setFromObject(currentModel);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    currentModel.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
    const radius = Math.max(size.x, size.y, size.z);
    grid.scale.setScalar(Math.max(radius / 2, 0.1));
    camera.position.set(radius * 1.3, radius * 0.85, radius * 1.6);
    camera.near = radius / 1000;
    camera.far = radius * 100;
    camera.updateProjectionMatrix();
    controls.target.set(0, radius * 0.4, 0);
    controls.update();
    $('viewer-empty').hidden = true;
  }, undefined, (error) => showError(new Error(`GLB 解析失败：${error.message}`)));
  $('download').hidden = false;
  $('download').textContent = '下载 GLB ↓';
  $('download').onclick = async () => {
    const file = await fetch(activeAsset.model_url, { headers: headers() });
    const url = URL.createObjectURL(await file.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activeAsset.asset_id}.glb`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('meta-id').textContent = asset.asset_id;
  $('meta-id').title = asset.asset_id;
  const physical = asset.physicalDimensionsMm;
  const size = physical || asset.spatial.size_mm;
  const width = physical ? physical.width : size.w;
  const depth = physical ? physical.depth : size.d;
  const height = physical ? physical.height : size.h;
  $('meta-size').textContent = `${width.toFixed(0)} × ${depth.toFixed(0)} × ${height.toFixed(0)} mm`;
  $('meta-mode').textContent = asset.generation.is_real_generation ? '真实生成' : 'Demo 示例';
  $('meta-scale').textContent = asset.scaleSource === 'user_confirmed' ? '用户已确认' : '类别默认，待确认';
}

health();
