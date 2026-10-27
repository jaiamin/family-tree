function photoCropRect(width, height, zoom, centerX, centerY) {
  const side = Math.min(width, height) / Math.max(1, Math.min(3, zoom));
  return { side, x: Math.max(0, Math.min(width - side, centerX - side / 2)), y: Math.max(0, Math.min(height - side, centerY - side / 2)) };
}
async function createPhotoCrop(file) {
  const image = await createImageBitmap(file);
  const node = document.createElement("div"); node.className = "photo-crop";
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 512;
  canvas.className = "photo-preview"; canvas.tabIndex = 0;
  canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", "Photo crop. Drag or use arrow keys to position your face.");
  const controls = document.createElement("div");
  const label = document.createElement("label"); label.textContent = "Zoom";
  const zoom = document.createElement("input"); zoom.type = "range"; zoom.min = "1"; zoom.max = "3"; zoom.step = "0.01"; zoom.value = "1";
  label.append(zoom);
  const hint = document.createElement("p"); hint.textContent = "Drag the photo to position your face.";
  controls.append(label, hint); node.append(canvas, controls);
  let centerX = image.width / 2, centerY = image.height / 2, pointer;
  const rect = () => photoCropRect(image.width, image.height, Number(zoom.value), centerX, centerY);
  const draw = () => {
    const crop = rect(); centerX = crop.x + crop.side / 2; centerY = crop.y + crop.side / 2;
    canvas.getContext("2d").drawImage(image, crop.x, crop.y, crop.side, crop.side, 0, 0, 512, 512);
  };
  zoom.oninput = draw;
  canvas.onpointerdown = event => {
    if (!event.isPrimary) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId); event.preventDefault();
  };
  canvas.onpointermove = event => {
    if (pointer?.id !== event.pointerId) return;
    const ratio = rect().side / canvas.getBoundingClientRect().width;
    centerX -= (event.clientX - pointer.x) * ratio; centerY -= (event.clientY - pointer.y) * ratio;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }; draw();
  };
  canvas.onpointerup = canvas.onpointercancel = () => { pointer = null; };
  canvas.onkeydown = event => {
    const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!offsets[event.key]) return;
    event.preventDefault();
    const [x, y] = offsets[event.key], step = rect().side / 20;
    centerX += x * step; centerY += y * step; draw();
  };
  draw();
  return { node, destroy: () => image.close(), blob: () => {
    const crop = rect(), output = document.createElement("canvas");
    output.width = output.height = Math.max(1, Math.min(512, Math.floor(crop.side)));
    output.getContext("2d").drawImage(image, crop.x, crop.y, crop.side, crop.side, 0, 0, output.width, output.height);
    return new Promise((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error("Couldn't prepare this photo.")), "image/jpeg", 0.85));
  } };
}
if (typeof module !== "undefined") module.exports = { photoCropRect };
