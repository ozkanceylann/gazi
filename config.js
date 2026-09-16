// MARKA CONFIG YÜKLEYİCİ
window.CONFIG = {};
window.CONFIG_READY = false;

async function loadBrandConfig() {
  try {
    const res = await fetch("brand.config.json?ts=" + Date.now());
    if (!res.ok) throw new Error("brand.config.json bulunamadı");
    window.CONFIG = await res.json();
    window.CONFIG_READY = true;
    console.log("✔ Config yüklendi:", window.CONFIG);
  } catch (e) {
    console.error("Config yüklenemedi:", e);
  }
}
loadBrandConfig();

// Diğer scriptler bekleyebilsin diye:
window.waitConfig = async function () {
  while (!window.CONFIG_READY) await new Promise(r => setTimeout(r, 40));
};
