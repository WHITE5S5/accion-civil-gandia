// Sanitizado de nombres públicos — generado por scripts (LDNOOBW + raíces curadas).
// Detección por RAÍZ (\\b delante) para cazar derivados/diminutivos + lista de palabras completas.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const ROOTS = ["put[aoi]","puton","putill","putaz","putern","putarr","putiv","putor","zorr","guarr","ramera","fulan","meretriz","buscon","pelandusc","pendon","cabron","cabro\\b","cabrit","cabronaz","cabronc","mierd","kk\\b","sorete","gilipoll","gilipich","gilipuert","jilipoll","jipoll","gili\\b","capull","maric","marik","mariq","sarasa","bollera","bujarr","travelo","nenaz","cojon","cojion","cojonaz","polla\\b","pollon","pollaz","pollabob","verga\\b","vergaz","pich[aoi]","cipote","minga\\b","nabo\\b","rabo\\b","chorra\\b","carall","cony","chupapoll","chupacir","chupam","soplapoll","comepoll","lamepoll","mamapoll","mamon","mamah","lamecul","comemierd","tocapelot","tocacojon","tocahuev","soplagaita","follar","follon","follad","folleteo","follam","jodid","jodet","joder","jode\\b","hijoput","hijaput","hijodeput","hijadeput","hdp\\b","malparid","malparit","malnacid","malaje","subnormal","subnorm","imbecil","idiot","estupid","tont","bobo\\b","boba\\b","bobit","bobalic","memo\\b","mema\\b","panoli","pringad","pardill","palurd","cateto","ceporr","besug","merluz","majader","mentecat","mendrug","zoquete","zopenc","tarug","tarumba","lelo\\b","panfil","papanat","patan\\b","cazurr","garrul","alcornoque","adoquin","berzas","cenutrio","chalad","chiflad","pirad","majara","mongol","mongolic","retrasad","tarad","anormal","ganan","zampabollos","ganapan","payas","negrat","sudac","panchit","gitanaz","sinverguenz","sinverg","cornud","baboso","rastrer","escoria","gentuza","chusma","malparid","huevon","guevon","ahueva","pendej","naco\\b","culer","collon","merda","filldeput","fill de put","cardar","sapastr","capsigrany","gamarus","tanoca","ximple","poca-solt","cagon","cagat","cagad","fuck","shit","bitch","cunt","dick\\b","pussy","whore","slut","bastard","asshol","arsehol","motherf","wank","cocksuck","twat","faggot","fagg","nigg","retard","dumbass","jackass","douche","prick\\b","bollock","bugger","cocksuck","cum\\b","cumshot","blowjob","dildo","boner"];
const WORDS = ["2g1c","acrotomophilia","anal","anilingus","apeshit","arsehole","asshole","assmunch","autoerotic","babeland","bangbros","bangbus","bareback","barenaked","bastard","bastardo","bastinado","bdsm","beaner","beaners","beastiality","bestiality","bimbos","birdlock","bitch","bitches","blowjob","blumpkin","bollera","bollocks","bondage","boner","bukkake","bulldyke","bullshit","bunghole","busty","buttcheeks","butthole","cabron","caca","camgirl","camslut","camwhore","carpetmuncher","chupada","chupapollas","chupeton","circlejerk","clusterfuck","cock","cocks","coon","coons","coprolagnia","coprophilia","cornhole","creampie","culo","cumming","cumshot","cumshots","cunnilingus","cunt","darkie","daterape","deepthroat","dendrophilia","dick","dildo","dingleberries","dingleberry","doggiestyle","doggystyle","dolcett","domination","dominatrix","dommes","dvda","ecchi","ejaculation","eunuch","faggot","fecal","felch","fellatio","feltch","femdom","figging","fingerbang","fingering","fisting","follador","follar","footjob","frotting","fuck","fuckin","fucking","fucktards","fudgepacker","futanari","g-spot","gangbang","gilipichis","gilipollas","goatcx","goatse","gokkun","goodpoop","goregasm","guro","handjob","hardcore","hentai","hijaputa","hijoputa","homoerotic","honkey","hooker","humping","idiota","imbecil","intercourse","jailbait","jigaboo","jiggaboo","jiggerboo","jilipollas","jizz","juggs","kapullo","kike","kinbaku","kinkster","kinky","knobbing","lameculos","livesex","lovemaking","maciza","macizorra","mamada","marica","maricon","mariconazo","masturbate","masturbating","masturbation","mierda","milf","mong","motherfucker","muffdiving","nambla","nawashi","nazi","neonazi","nigga","nigger","nimphomania","nsfw","nutten","nympho","nymphomania","octopussy","omorashi","orgasm","orgy","paedophile","paki","panties","panty","pedo","pedobear","pedophile","pegging","pendejo","pervertido","pezon","pikey","pissing","pisspig","ponyplay","poof","poon","poontang","poopchute","prostituta","pthc","punany","pussy","puta","queaf","queef","quim","raghead","ramera","rimjob","rimming","sadism","santorum","scat","schlong","scissoring","sexcam","sexo","shemale","shibari","shit","shitblimp","shitty","shota","shrimping","skeet","slanteye","slut","smut","snatch","snowballing","sodomize","sodomy","soplagaitas","soplapollas","spastic","spic","splooge","spooge","spunk","strapon","strappado","swastika","swinger","threesome","throating","thumbzilla","tits","titties","titty","topless","tosser","towelhead","tranny","travesti","tribadism","trio","tubgirl","tushy","twat","twink","twinkie","undressing","upskirt","urophilia","verga","vibrator","vorarephilia","voyeur","voyeurweb","voyuer","wank","wetback","whore","worldsex","yaoi","yiffy","zoophilia"];
const CARGOS = ["president","vicepresident","expresident","alcald","exalcald","concejal","regidor","diputad","senador","ministr","secretari","tesorer","portavoz","portaveu","candidat","honorable","excelentisim","ilustrisim","excelentissim","gobernador","dirigent","conseller","consellera"];
const ROOT_RE = new RegExp('\\b(?:' + ROOTS.join('|') + ')', 'i');
const WORD_RE = new RegExp('\\b(?:' + WORDS.join('|') + ')s?\\b', 'i');
const CARGO_RE = new RegExp('\\b(?:' + CARGOS.join('|') + ')', 'i');
const ACENT_RE = /co[ñn]o|coñaz|puñeter|cag[uü]en|cabr[oó]n/i;

export function cleanName(raw) {
  let n = String(raw || '').replace(/\s+/g, ' ').trim();
  n = n.replace(/[^\p{L}\p{N} .''·\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (n.replace(/[^\p{L}]/gu, '').length < 2) return { ok: false, reason: 'corto' };
  const low = norm(n), rawLow = n.toLowerCase();
  const compact = low.replace(/(.)\1{2,}/g, '$1');   // putiiita -> putita
  if (ROOT_RE.test(low) || ROOT_RE.test(compact) || WORD_RE.test(low) || ACENT_RE.test(rawLow))
    return { ok: false, reason: 'lenguaje' };
  if (CARGO_RE.test(low)) return { ok: false, reason: 'cargo' };
  return { ok: true, nombre: n };
}
export const SPECIAL_ACCOUNTS = { 'accioncivilgandia@gmail.com': { honor: 'Presidente', rol: 'admin' } };
// Separa el cargo honorífico del nombre público (solo lo tienen cuentas especiales).
// "Presidente Alejandro Alcazar" -> { cargo:'Presidente', nombre:'Alejandro Alcazar' }
export function splitCargo(full) {
  const s = String(full || '').trim();
  const sp = s.indexOf(' ');
  if (sp > 0 && CARGO_RE.test(norm(s.slice(0, sp)))) return { cargo: s.slice(0, sp), nombre: s.slice(sp + 1).trim() };
  return { cargo: '', nombre: s };
}
export function withHonor(honor, base) {
  const b = String(base || '').replace(new RegExp('^\\s*' + honor + '\\s+', 'i'), '').trim() || 'Acción Civil';
  return `${honor} ${b}`.slice(0, 60);
}
