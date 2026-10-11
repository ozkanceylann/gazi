window.CONFIG = {};
window.CONFIG_READY = false;
window.configPromise = (async () => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let res;
    try { res = await fetch("brand.config.json?ts=" + Date.now(), {signal:controller.signal}); }
    finally { clearTimeout(timer); }
    if (!res.ok) throw new Error("Marka ayarları alınamadı");
    const config = await res.json();
    if (!config.table || !config.brand || !config.webhooks) throw new Error("Marka ayarları eksik");
    window.CONFIG = config;
    window.CONFIG_READY = true;
    return config;
  } catch (error) {
    console.error("Ayarlar yüklenemedi:", error);
    const showError = () => {
      const box = document.createElement("div");
      box.setAttribute("role","alert");
      box.style.cssText = "position:fixed;inset:0;z-index:20000;background:#f3f6f4;display:grid;place-content:center;padding:24px;text-align:center;font-family:system-ui";
      const text = document.createElement("p");
      text.textContent = "Site ayarları yüklenemedi. İnternet bağlantınızı kontrol edip yeniden deneyin.";
      const button = document.createElement("button");
      button.textContent = "Yeniden Dene";
      button.onclick = () => location.reload();
      box.append(text,button); document.body.appendChild(box);
    };
    if (document.body) showError();
    else document.addEventListener("DOMContentLoaded",showError,{once:true});
    throw error;
  }
})();
window.configPromise.catch(() => {});
window.waitConfig = () => window.configPromise;

window.requireSession = async function(db) {
  const {data, error} = await db.auth.getUser();
  if (error || !data?.user) {
    location.replace("login.html");
    throw new Error("Oturum bulunamadı");
  }
  return data.user;
};
