const cache=new Map();
export function branchKey(city,district){return String(city)+'|'+String(district).toLocaleLowerCase('tr-TR').trim();}
export function bindBranchSelector({order,locked,request,root=document}){
 const get=id=>root.getElementById(id),delivery=get('delivery_select'),city=get('sehir_select'),district=get('ilce_select'),select=get('delivery_branch_select'),name=get('delivery_branch'),info=get('delivery_branch_info'),address=get('adres'),retry=get('delivery_branch_retry');
 let serial=0,branches=[],previousAddress=address.value,appliedAddress=null;
 const option=(value,label)=>{const e=root.createElement('option');e.value=value;e.textContent=label;return e;};
 const placeholder=text=>{select.replaceChildren(option('',text));select.disabled=true;};
 const apply=()=>{const b=branches.find(x=>x.code===select.value);if(!b)return;name.value=b.name;address.value=b.address;appliedAddress=b.address;info.textContent=b.address+(b.phone?' · '+b.phone:'');};
 async function refresh(force=false){
  const id=++serial;branches=[];retry.hidden=true;
  if(locked){select.replaceChildren(option('',order.teslim_subesi||'Kayıtlı şube'));select.disabled=true;return;}
  if(delivery.value!=='true'){if(appliedAddress&&address.value===appliedAddress)address.value=previousAddress;appliedAddress=null;return;}
  const code=city.value,label=district.selectedOptions?.[0]?.textContent||'';
  if(!code||!district.value){name.value='';placeholder('Önce il ve ilçe seçin');info.textContent='';return;}
  placeholder('DHL şubeleri yükleniyor…');info.textContent='';
  try{
   const key=branchKey(code,label),saved=cache.get(key);
   const result=!force&&saved&&saved.expires>Date.now()?saved.data:await request({city_code:code,district_name:label});
   if(!result||!Array.isArray(result.branches))throw Error('DHL şube listesi alınamadı.');
   if(id!==serial||!select.isConnected||delivery.value!=='true')return;
   cache.set(key,{data:result,expires:Date.now()+15*60*1000});
   branches=result.branches.filter(b=>b.code&&b.name&&b.address);
   select.replaceChildren(option('',branches.length?'DHL şubesi seçin':'Bu ilçede listelenen şube yok'));
   for(const b of branches)select.appendChild(option(b.code,b.name+' · '+b.code));
   select.disabled=!branches.length;
   if(!branches.length){name.value='';info.textContent='Şubenin bulunduğu il ve ilçeyi seçebilirsiniz.';return;}
   const old=branches.find(b=>b.name.toLocaleLowerCase('tr-TR')===String(name.value).toLocaleLowerCase('tr-TR'));
   if(old){select.value=old.code;apply();}else name.value='';
  }catch(error){if(id!==serial||!select.isConnected)return;name.value='';placeholder('Şube listesi alınamadı');info.textContent=error.message||'Yeniden deneyin.';retry.hidden=false;}
 }
 select.addEventListener('change',apply);
 delivery.addEventListener('change',()=>{if(delivery.value==='true'&&!appliedAddress)previousAddress=address.value;void refresh();});
 city.addEventListener('change',()=>{++serial;name.value='';placeholder('Önce ilçe seçin');info.textContent='';});
 district.addEventListener('change',()=>{name.value='';void refresh();});
 retry.addEventListener('click',()=>void refresh(true));
 void refresh();
 return {valid:()=>locked||delivery.value!=='true'||Boolean(select.value&&branches.some(b=>b.code===select.value)),refresh};
}
