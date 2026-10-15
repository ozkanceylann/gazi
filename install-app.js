(() => {
  const button=document.getElementById('installAppBtn');
  if(!button)return;
  const standalone=window.matchMedia('(display-mode: standalone)');
  const mobile=window.matchMedia('(max-width: 900px), (hover: none) and (pointer: coarse)');
  let deferred=null,installed=false;
  const isInstalled=()=>installed||standalone.matches||navigator.standalone===true;
  const update=()=>{button.hidden=isInstalled()||(!mobile.matches&&!deferred);};
  standalone.addEventListener('change',update);
  mobile.addEventListener('change',update);
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferred=event;update();});
  window.addEventListener('appinstalled',()=>{installed=true;deferred=null;update();});
  function showHelp(){
    if(document.getElementById('installAppHelp'))return;
    const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    const dialog=document.createElement('dialog');dialog.id='installAppHelp';dialog.setAttribute('aria-labelledby','installAppHelpTitle');
    const image=document.createElement('img');image.src='/icons/siparis-operasyon-192.png';image.alt='';image.width=64;image.height=64;
    const title=document.createElement('h2');title.id='installAppHelpTitle';title.textContent='Sipariş Operasyon';
    const text=document.createElement('p');text.textContent=ios?'Paylaş menüsünü açın → Ana Ekrana Ekle → Ekle. Uygulama, paket simgesiyle ana ekranınızda görünecek.':'Tarayıcının ⋮ menüsünü açın → Uygulamayı yükle veya Ana ekrana ekle → Yükle / Ekle.';
    const close=document.createElement('button');close.type='button';close.textContent='Tamam';close.addEventListener('click',()=>dialog.close());
    dialog.append(image,title,text,close);dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
  }
  button.addEventListener('click',async()=>{
    if(!deferred){showHelp();return;}
    const prompt=deferred;deferred=null;button.disabled=true;
    try{await prompt.prompt();const choice=await prompt.userChoice;if(choice.outcome==='accepted')installed=true;}
    catch{showHelp();}
    finally{button.disabled=false;update();}
  });
  update();
})();
