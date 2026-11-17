const fs = require('node:fs');
const path = require('node:path');
const sharp = require('C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const out = __dirname;
const glyph = JSON.parse(fs.readFileSync(path.join(out, 'wordmark-source.json'), 'utf8').replace(/^\uFEFF/, ''));
const navy = '#0D1B2A', teal = '#1BA39C', mint = '#73C6B6';
// Master geometry on a 256-unit canvas. All variants reuse these three paths.
const paths = [
  'M64 16H202C219 16 223 25 211 37L120 128C111 137 104 141 91 138L29 123C20 121 16 115 16 106V64C16 37.49 37.49 16 64 16Z',
  'M228 51C234 46 240 54 240 67V192C240 218.51 218.51 240 192 240H169C160 240 156 235 153 226L133 166C130 156 132 149 139 142Z',
  'M33 140L95 155C105 157 111 163 115 174L135 230C137 236 134 240 128 240H64C37.49 240 16 218.51 16 192V156C16 144 22 138 33 140Z',
];
function mark(colors = [navy, teal, mint]) { return paths.map((d,i)=>`<path fill="${colors[i]}" d="${d}"/>`).join(''); }
function at(x,y,size,colors) {return `<g transform="translate(${x} ${y}) scale(${size/256})">${mark(colors)}</g>`;}
function word(x,y,h,color=navy) {const s=h/glyph.height; return `<g transform="translate(${x} ${y}) scale(${s}) translate(${-glyph.x} ${-glyph.y})"><path fill="${color}" d="${glyph.d}"/></g>`;}
function svg(w,h,body,label) {return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">${body}</svg>`;}
function save(name,data){fs.writeFileSync(path.join(out,name),data+'\n');}
const text=(x,y,s,size=16,color='#5B6B78',weight=400)=>`<text x="${x}" y="${y}" font-family="Segoe UI, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${s}</text>`;
async function main(){
  save('mark.svg',svg(256,256,mark(),'HarmoFin'));
  save('mark-mono.svg',svg(256,256,mark([navy,navy,navy]),'HarmoFin'));
  save('mark-inverse.svg',svg(256,256,mark(['#FFFFFF','#FFFFFF','#FFFFFF']),'HarmoFin'));
  save('logo.svg',svg(510,128,at(0,0,128)+word(151,37,57),'HarmoFin'));
  save('logo-inverse.svg',svg(510,128,at(0,0,128,['#FFFFFF','#FFFFFF','#FFFFFF'])+word(151,37,57,'#FFFFFF'),'HarmoFin'));
  save('app-icon.svg',svg(512,512,`<rect width="512" height="512" rx="112" fill="${navy}"/>`+at(64,64,384,['#FFFFFF',teal,mint]),'HarmoFin'));
  const samples=[16,24,32,48];
  for(const size of samples){
    await sharp(Buffer.from(svg(256,256,mark(),'HarmoFin'))).resize(size,size).png().toFile(path.join(out,`mark-${size}.png`));
    await sharp(Buffer.from(svg(256,256,mark([navy,navy,navy]),'HarmoFin'))).resize(size,size).png().toFile(path.join(out,`mark-mono-${size}.png`));
  }
  await sharp(path.join(out,'app-icon.svg')).png().toFile(path.join(out,'app-icon-512.png'));
  // Identity and interface studies, not screenshots of the running product.
  let body='<rect width="1440" height="1160" fill="#F7F9FA"/>';
  body+=text(56,58,'HarmoFin / Общее целое',28,navy,600)+text(56,88,'Векторная версия 01 · примерка айдентики',16);
  body+='<rect x="40" y="118" width="1360" height="340" rx="24" fill="white"/>';
  body+=at(64,143,278)+word(408,191,82)+text(408,325,'Три части. Одна устойчивая форма.',21);
  body+=at(1056,170,105,[navy,navy,navy])+`<rect x="1200" y="157" width="144" height="144" rx="24" fill="${navy}"/>`+at(1216,173,112,['white','white','white']);
  body+=text(408,408,'Navy  #0D1B2A     Teal  #1BA39C     Mint  #73C6B6',17);
  body+=text(56,506,'Маленькие размеры · показаны 1:1',19,navy,600);
  let x=65;for(const n of samples){body+=at(x,534,n)+text(x,610,`${n} px`,14);body+=at(x,635,n,[navy,navy,navy]);x+=128;}
  body+=text(660,506,'Иконка приложения',19,navy,600)+`<rect x="668" y="534" width="128" height="128" rx="28" fill="${navy}"/>`+at(684,550,96,['white',teal,mint]);
  body+=text(900,506,'На тёмном фоне',19,navy,600)+`<rect x="890" y="526" width="494" height="174" rx="20" fill="${navy}"/>`+at(914,565,90,['white','white','white'])+word(1024,589,35,'white');
  body+=text(56,756,'Примерка в интерфейсе · статические макеты',19,navy,600);
  body+='<rect x="40" y="778" width="1360" height="124" rx="18" fill="white"/>';
  body+=at(65,812,52)+word(132,827,23)+text(435,848,'Возможности',16)+text(598,848,'Как это работает',16)+text(804,848,'Безопасность',16)+text(1030,848,'Войти',16,navy);
  body+=`<rect x="1132" y="816" width="228" height="48" rx="10" fill="#127A75"/>`+text(1160,847,'Начать бесплатно',17,'white',600);
  body+=`<rect x="40" y="924" width="280" height="190" rx="18" fill="${navy}"/>`+at(63,946,44,['white','white','white'])+word(118,960,21,'white')+text(72,1040,'Обзор бюджета',18,'white',600)+text(72,1080,'Счета и конверты',16,'#AFBDC8');
  body+='<rect x="344" y="924" width="1056" height="190" rx="18" fill="white"/>';
  body+=text(380,969,'Можно потратить',22,navy,600)+text(380,1030,'31 500 ₽',44,navy,600)+text(380,1073,'Демонстрационный фрагмент интерфейса',16);
  save('preview.svg',svg(1440,1160,body,'HarmoFin — лист примерки логотипа'));
  await sharp(path.join(out,'preview.svg')).png().toFile(path.join(out,'preview.png'));
  console.log('Generated 6 asset SVGs, preview SVG/PNG, 8 actual-size PNGs, app icon PNG.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
