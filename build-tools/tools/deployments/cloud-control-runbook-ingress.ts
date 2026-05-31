import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import type { RunbookCommand } from "./cloud-control-runbook";

export function ingressEvidenceCommands(
  input: CloudControlSetupInput,
  rootPrelude: string,
): RunbookCommand[] {
  if (input.mode !== "aws-ec2") return [];
  return [
    command(input, rootPrelude, "ingress-dns", "dns", "ingress-dns-evidence.json"),
    command(input, rootPrelude, "ingress-tls", "tls", "ingress-tls-evidence.json"),
    command(input, rootPrelude, "ingress-health", "health", "ingress-health-evidence.json"),
    command(input, rootPrelude, "ingress-callback", "callback", "ingress-callback-evidence.json"),
  ];
}

function command(
  input: CloudControlSetupInput,
  rootPrelude: string,
  id: string,
  collector: string,
  output: string,
): RunbookCommand {
  return {
    id,
    command: `${rootPrelude}; export PROFILE_ROOT; node -e ${shellQuote(program(input, collector, output))}`,
    cwd: "profile-root",
    inputs: ["$PROFILE_ROOT/aws-topology-evidence.json", "$PROFILE_ROOT/config.yaml"],
    outputs: [`$PROFILE_ROOT/${output}`],
    mustPass: `${collector} probe collects fresh structured ingress evidence with redacted stdout/stderr`,
  };
}

function program(input: CloudControlSetupInput, collector: string, output: string): string {
  const settings = {
    collector,
    output,
    publicUrl: input.publicUrl,
    callbackUrl: `https://${input.authCallbackHost}${input.authCallbackPath}`,
  };
  return [
    "const cp=require('child_process'),dns=require('dns').promises,fs=require('fs'),tls=require('tls');",
    `const settings=${JSON.stringify(settings)};`,
    "const root=process.env.PROFILE_ROOT||process.cwd();",
    "const topology=JSON.parse(fs.readFileSync(`${root}/aws-topology-evidence.json`,'utf8'));",
    "const ingress=topology.ingress||{}, now=()=>new Date().toISOString();",
    "const sha=(v)=>'sha256:'+require('crypto').createHash('sha256').update(JSON.stringify(v)).digest('hex');",
    "const names=(s)=>String(s||'').split(/,\\s*/).filter(Boolean).map(x=>x.replace(/^DNS:/,'').replace(/^IP Address:/,''));",
    "const covers=(host,san)=>san.some(n=>n===host||(n.startsWith('*.')&&host.endsWith(n.slice(1))&&host.split('.').length===n.split('.').length));",
    "const red=(v,k='')=>Array.isArray(v)?v.map((x)=>red(x,k)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([a,b])=>[a,red(b,a)])):typeof v==='string'&&k!=='checkedAt'?v.replace(/arn:aws[a-z-]*:[^:\\s]+:[^:\\s]*:\\d{12}:[^\\s,;]+/g,'arn:aws:<redacted>').replace(/\\b[a-z0-9-]+(?:\\.[a-z0-9-]+)+\\b/gi,'<hostname:redacted>'):v;",
    "async function dnsProbe(){const u=new URL(settings.publicUrl);const lb=(ingress.loadBalancer||{}).dnsName||'';const r=await dns.lookup(u.hostname,{all:true});let lr=[],cn=[];try{lr=lb?await dns.lookup(lb,{all:true}):[]}catch{}try{cn=await dns.resolveCname(u.hostname)}catch{}const pub=r.map(x=>x.address),sel=lr.map(x=>x.address);const matched=pub.some(x=>sel.includes(x))||cn.some(x=>x===lb||x.endsWith('.'+lb))||u.hostname===lb;return {checkedAt:now(),hostname:u.hostname,recordType:'A',resolved:pub.length>0,resolvedTargetMatchesSelectedIngress:matched,publicResolution:pub,selectedIngressResolution:sel,selectedLoadBalancerDnsNameDigest:sha(lb),publicVantagePoint:process.env.VBR_INGRESS_PUBLIC_VANTAGE_POINT||'operator-runbook',targetLoadBalancerArn:(ingress.loadBalancer||{}).arn,proofDigest:sha({pub,sel,cn})}}",
    "function tlsProbe(){return new Promise((res,rej)=>{const u=new URL(settings.publicUrl);const cb=new URL(settings.callbackUrl);const allow=process.env.VBR_INGRESS_TLS_ALLOW_UNTRUSTED==='1';const s=tls.connect({host:u.hostname,port:Number(process.env.VBR_INGRESS_TLS_PORT||u.port||443),servername:u.hostname,rejectUnauthorized:!allow,timeout:8000},()=>{const c=s.getPeerCertificate();const san=names(c.subjectaltname);res({checkedAt:now(),host:u.hostname,handshake:true,authorized:s.authorized,authorizationError:s.authorizationError||'',notBefore:c.valid_from||'',notAfter:c.valid_to||'',subjectAlternativeNames:san,coverageMatchedPublicUrl:covers(u.hostname,san),coverageMatchedCallbackHost:covers(cb.hostname,san),fingerprint256:c.fingerprint256||'',proofDigest:sha(c)});s.end()});s.on('timeout',()=>{s.destroy();rej(new Error('TLS probe timed out'))});s.on('error',rej)})}",
    "async function healthProbe(){const u=new URL('/readyz',settings.publicUrl.endsWith('/')?settings.publicUrl:settings.publicUrl+'/');const readiness=await fetch(u,{headers:{'user-agent':'cloud-control-runbook-ingress'}});let targetHealth={source:'fixture-required-unless-live'};if(process.env.VBR_INGRESS_AWS_LIVE==='1'){const out=cp.execFileSync('aws',['elbv2','describe-target-health','--target-group-arn',ingress.targetGroupArn,'--output','json'],{encoding:'utf8'});targetHealth=JSON.parse(out)}else if(process.env.VBR_INGRESS_TARGET_HEALTH_FIXTURE){targetHealth=JSON.parse(fs.readFileSync(process.env.VBR_INGRESS_TARGET_HEALTH_FIXTURE,'utf8'))}else throw new Error('target health collection requires VBR_INGRESS_AWS_LIVE=1 or VBR_INGRESS_TARGET_HEALTH_FIXTURE');const reg=ingress.targetRegistration||{};const match=(targetHealth.TargetHealthDescriptions||[]).find(x=>(x.Target||{}).Id===reg.instanceId&&Number((x.Target||{}).Port||reg.port)===Number(reg.port));return {checkedAt:now(),readiness:{url:u.toString(),status:readiness.status,ok:readiness.ok},targetGroupArnDigest:sha(ingress.targetGroupArn||''),targetRegistration:reg,targetRegistrationBound:Boolean(match),targetHealthy:Boolean(match)&&((match.TargetHealth||{}).State)==='healthy',targetHealth,proofDigest:sha(targetHealth)}}",
    "async function callbackProbe(){const target=process.env.VBR_INGRESS_CALLBACK_URL||settings.callbackUrl;const route=ingress.callbackRoute||{};const r=await fetch(target,{redirect:'manual',headers:{host:route.host||''}});const observed=r.headers.get('x-vbr-target-group-arn')||'';return {checkedAt:now(),url:target,status:r.status,callbackHostDigest:sha(route.host||''),callbackPath:new URL(target).pathname,observedTargetGroupArnDigest:sha(observed),routeMatchesSelectedTargetGroup:observed===ingress.targetGroupArn&&r.headers.get('x-vbr-callback-route')==='selected',proofDigest:sha({status:r.status,target,observed})}}",
    "const probes={dns:dnsProbe,tls:tlsProbe,health:healthProbe,callback:callbackProbe};",
    "probes[settings.collector]().then((e)=>{const p={schemaVersion:'cloud-control-ingress-command-evidence@1',checkedAt:now(),source:'generated-runbook-command',collector:settings.collector,inputs:['aws-topology-evidence.json','config.yaml'],evidence:red(e)};fs.writeFileSync(`${root}/${settings.output}`,JSON.stringify(p,null,2)+'\\n')}).catch((e)=>{console.error(red(String(e&&e.stack||e)));process.exit(1)});",
  ].join("");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
