function parseCargoWeights(value, count, repeatSingle = true) {
  count = Number(count);
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error("Paket adedi 1–100 olmalı.");
  let raw = String(value ?? "").replace(/kg/gi, "").trim();
  if (raw.startsWith("[")) {
    let items; try { items = JSON.parse(raw); } catch { throw new Error("KG listesi geçersiz."); }
    if (!Array.isArray(items) || !items.length || items.some(x => !["string","number"].includes(typeof x))) throw new Error("KG listesi geçersiz.");
    raw = items.join("+");
  }
  if (!raw) throw new Error("Her paket için KG yazın. Örnek: 5+10+5+6");
  const plus = raw.includes("+");
  let parts = plus ? raw.split("+") : count === 1 ? [raw] : raw.split(/[,|/;\s]+|(?<=\d)-(?=\d)/);
  parts = parts.map(part => part.trim());
  if (parts.some(part => !/^\d+(?:[.,]\d+)?$/.test(part))) throw new Error("KG bilgisi geçersiz. Paketleri + ile ayırın.");
  let weights = parts.map(part => Number(part.replace(",", ".")));
  if (weights.some(kg => !Number.isFinite(kg) || kg <= 0)) throw new Error("Paket kilogramları sıfırdan büyük olmalı.");
  // A historical single weight applied to every parcel. Keep that interpretation on reads.
  if (!plus && repeatSingle && weights.length === 1 && count > 1) weights = Array(count).fill(weights[0]);
  if (weights.length !== count) throw new Error("KG sayısı paket adediyle aynı olmalı. Örnek: 5+10");
  return weights;
}
(function(root) {
  root.CargoWeights = {
    parse: parseCargoWeights,
    normalize: (value,count) => parseCargoWeights(value,count).join("+"),
    display: (value,count) => { try { return parseCargoWeights(value,count).join("+"); } catch { const raw = String(value ?? "").replace(/kg/gi,"").trim(); return /^\d+(?:\.\d+)?(?:\s*[,+]\s*\d+(?:\.\d+)?)+$/.test(raw) ? raw.replace(/\s*,\s*/g,"+") : String(value ?? ""); } }
  };
})(globalThis);

