import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const suites=readdirSync(new URL('.',import.meta.url)).filter(name=>/^test-.*\.mjs$/.test(name)&&name!=='test-all.mjs'||name==='generate-combat-audio.test.mjs').sort();
for(const name of suites){
 console.log(`\n=== ${name} ===`);
 const run=spawnSync(process.execPath,['--experimental-vm-modules',`scripts/${name}`],{stdio:'inherit'});
 if(run.error)throw run.error;
 if(run.status!==0)process.exit(run.status??1);
}
console.log(`\nAll ${suites.length} test scripts passed.`);
