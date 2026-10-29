/* Lokale Browserprüfung mit simulierten Recovery-Antworten, ohne echte E-Mails/Konten. */
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||require.resolve('playwright',{paths:[path.resolve(__dirname,'../web')]}));
const run=(async()=>{
 const vite=await (await import(require.resolve('vite',{paths:[path.resolve(__dirname,'../web')]}))).preview({root:path.resolve(__dirname,'../web'),preview:{host:'127.0.0.1',port:5175,strictPort:true}});
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process']}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let ready=false,sessionPosts=0,passwordPosts=0,emailRequests=0,requestedEmail='',invalid=false,sessionUnavailable=false,saveUnavailable=false,expireOnSave=false,rateLimited=false;
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  await page.route(url=>url.pathname.startsWith('/api/'),async route=>{
   const req=route.request(),p=new URL(req.url()).pathname;
   const headers={'Access-Control-Allow-Origin':'http://127.0.0.1:5175','Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS'};
   const json=(body,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)});
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
   if(p==='/api/auth/session')return json({authenticated:false,email:null,role:null});
   if(p==='/api/auth/recovery/request'){
    emailRequests++;requestedEmail=req.postDataJSON().email;await pause(180);
    return rateLimited?json({detail:'Zu viele Anfragen. Bitte versuche es später erneut.'},429):json({requested:true});
   }
   if(p==='/api/auth/recovery/session'){
    if(req.method()==='DELETE'){ready=false;return json({cleared:true});}
    if(req.method()==='POST'){
     sessionPosts++;assert.deepEqual(Object.keys(req.postDataJSON()),['access_token']);await pause(200);
     if(sessionUnavailable)return json({detail:'Test: Verbindung vorübergehend unterbrochen.'},503);
     if(invalid){ready=false;return json({detail:'Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.'},401);}
     ready=true;
    }
    return json(ready?{ready:true,email:'recovery@example.test'}:{ready:false});
   }
   if(p==='/api/auth/recovery/password'){
    passwordPosts++;assert.deepEqual(Object.keys(req.postDataJSON()),['password']);await pause(200);
    if(expireOnSave){ready=false;return json({detail:'Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.'},401);}
    if(saveUnavailable)return route.abort('failed');
    ready=false;return json({updated:true});
   }
   return json({detail:'Unbekannter Test-Endpunkt'},404);
  });
  const base='http://127.0.0.1:5175/';
  const link=()=>base+'#access_token=test-access-token&refresh_token=test-refresh-not-stored&type=recovery';
  const screenshot=async name=>{if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.SCREENSHOT_DIR+'/'+name+'.png'});}};
  await page.goto(base+'#/login');
  await page.getByRole('link',{name:'Passwort vergessen?',exact:true}).click();
  await page.getByLabel('E-Mail-Adresse:',{exact:true}).fill('recovery@example.test');
  rateLimited=true;
  await page.getByRole('button',{name:'Link anfordern',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Zu viele Anfragen'}).waitFor();
  rateLimited=false;
  await page.getByRole('button',{name:'Link anfordern',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Falls für diese E-Mail-Adresse ein Konto besteht'}).waitFor();
  assert.equal(requestedEmail,'recovery@example.test');assert.equal(emailRequests,2);
  assert.equal(await page.getByRole('button',{name:'Link anfordern',exact:true}).count(),0);
  console.log('PASS: Passwort-vergessen-Link, E-Mail-Anfrage, Rate-Limit und neutrale Bestätigung');

  await page.goto(link());
  await page.getByText('recovery@example.test',{exact:true}).waitFor();
  assert.equal(sessionPosts,1);
  assert.equal(new URL(page.url()).hash,'#/reset-password');
  assert.equal(await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]).includes('test-access-token')),false);
  assert.equal(await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]).includes('test-refresh-not-stored')),false);
  await screenshot('reset-desktop');
  await page.reload();
  await page.getByText('recovery@example.test',{exact:true}).waitFor();
  assert.equal(sessionPosts,1);
  await page.getByLabel('Neues Passwort:',{exact:true}).fill('new-test-password');
  await page.getByLabel('Wiederholen:',{exact:true}).fill('different-test-password');
  await page.getByRole('button',{name:'Passwort speichern',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Die Passwörter stimmen nicht überein.'}).waitFor();
  assert.equal(passwordPosts,0);
  await page.getByLabel('Wiederholen:',{exact:true}).fill('new-test-password');
  saveUnavailable=true;
  await page.getByRole('button',{name:'Passwort speichern',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Die Verbindung ist unterbrochen.'}).waitFor();
  saveUnavailable=false;
  await page.getByRole('button',{name:'Passwort speichern',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Dein Passwort wurde geändert.'}).waitFor();
  assert.equal(await page.locator('input[type="password"]').count(),0);
  await page.getByRole('button',{name:'Zur Anmeldung',exact:true}).click();
  await page.getByLabel('E-Mail-Adresse:',{exact:true}).waitFor();
  console.log('PASS: Recovery-Fragment bereinigt, einmaliger Austausch, Reload, Bestätigung, Netzfehler und Rückkehr zur Anmeldung');

  invalid=true;
  await page.goto(link());
  await page.getByRole('alert').filter({hasText:'ungültig oder abgelaufen'}).waitFor();
  assert.equal(await page.getByLabel('Neues Passwort:',{exact:true}).count(),0);
  invalid=false;ready=true;
  const before=sessionPosts;
  await page.setViewportSize({width:390,height:844});
  await page.goto(base+'#error=access_denied&error_code=otp_expired&error_description=test-description&sb=');
  await page.getByRole('alert').filter({hasText:'ungültig oder abgelaufen'}).waitFor();
  assert.equal(new URL(page.url()).hash,'#/reset-password?error=expired');
  assert.equal(sessionPosts,before);
  await page.reload();
  await page.getByRole('link',{name:'Neuen Link anfordern',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Neues Passwort:',{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>document.querySelector('.login-page').scrollWidth<=innerWidth),true);
  await screenshot('reset-expired-mobile');
  console.log('PASS: Ungültige Links und otp_expired sicher behandelt; alte Sitzung wird nicht übernommen');

  sessionUnavailable=true;
  await page.goto(link());
  await page.getByRole('button',{name:'Erneut prüfen',exact:true}).waitFor();
  sessionUnavailable=false;
  await page.getByRole('button',{name:'Erneut prüfen',exact:true}).click();
  await page.getByText('recovery@example.test',{exact:true}).waitFor();
  await screenshot('reset-mobile');
  expireOnSave=true;
  await page.getByLabel('Neues Passwort:',{exact:true}).fill('new-test-password');
  await page.getByLabel('Wiederholen:',{exact:true}).fill('new-test-password');
  await page.getByRole('button',{name:'Passwort speichern',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'ungültig oder abgelaufen'}).waitFor();
  assert.equal(await page.getByLabel('Neues Passwort:',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: Wiederholbare Linkprüfung, abgelaufene Sitzung beim Speichern und keine JavaScript-Fehler');
 }finally{await browser.close();await vite.close();}
})();
run.catch(error=>{console.error(error);process.exitCode=1;});module.exports=run;
