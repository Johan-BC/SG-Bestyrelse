// Dekrypterer og krypterer data.json uden for appen. Koden gives i miljøvariablen SG_CODE og må ikke skrives i repoet.
//   SG_CODE=... node tools/data.mjs decrypt > plain.json
//   SG_CODE=... node tools/data.mjs encrypt plain.json      (skriver data.json)
import {readFileSync,writeFileSync} from "node:fs";
import {webcrypto as c} from "node:crypto";
const code=process.env.SG_CODE; if(!code){console.error("SG_CODE mangler");process.exit(1);}
const b64=u=>Buffer.from(u).toString("base64"), un=s=>new Uint8Array(Buffer.from(s,"base64"));
async function key(salt){const km=await c.subtle.importKey("raw",new TextEncoder().encode(code),"PBKDF2",false,["deriveKey"]);
  return c.subtle.deriveKey({name:"PBKDF2",salt,iterations:200000,hash:"SHA-256"},km,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);}
const [cmd,file]=process.argv.slice(2);
if(cmd==="decrypt"){const o=JSON.parse(readFileSync(file||"data.json","utf8"));
  const pt=await c.subtle.decrypt({name:"AES-GCM",iv:un(o.iv)},await key(un(o.salt)),un(o.ct));
  process.stdout.write(JSON.stringify(JSON.parse(new TextDecoder().decode(pt)),null,1)+"\n");
}else if(cmd==="encrypt"){const plain=JSON.stringify(JSON.parse(readFileSync(file,"utf8")));
  let salt;try{salt=un(JSON.parse(readFileSync("data.json","utf8")).salt);}catch{salt=c.getRandomValues(new Uint8Array(16));}
  const iv=c.getRandomValues(new Uint8Array(12));
  const ct=await c.subtle.encrypt({name:"AES-GCM",iv},await key(salt),new TextEncoder().encode(plain));
  writeFileSync("data.json",JSON.stringify({v:1,salt:b64(salt),iv:b64(iv),ct:b64(new Uint8Array(ct))})+"\n");
}else{console.error("brug: decrypt [fil] | encrypt <fil>");process.exit(1);}
