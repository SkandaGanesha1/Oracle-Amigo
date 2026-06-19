import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL: "http://127.0.0.1:3427",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node -e \"const http=require('node:http'),fs=require('node:fs'),path=require('node:path');const root=path.resolve('public');const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://127.0.0.1');if(u.pathname==='/local-ui-session'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({ok:true,localUiSession:{enabled:true,runtime:'local-ui-session-v1',cookieName:'oa_local_ui_session',wasValid:true}}));return;}let p=path.join(root,u.pathname==='/'?'index.html':u.pathname);if(!p.startsWith(root)){res.writeHead(403).end();return;}fs.readFile(p,(e,b)=>{if(e){res.writeHead(404).end();return;}res.writeHead(200,{'content-type':types[path.extname(p)]||'application/octet-stream'});res.end(b);});});server.listen(3427,'127.0.0.1');setTimeout(()=>server.close(()=>process.exit(0)),120000);\"",
    url: "http://127.0.0.1:3427",
    reuseExistingServer: true,
    timeout: 30_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1000 }
  }
});
