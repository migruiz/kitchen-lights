const { Observable,Subject,merge,timer, interval } = require('rxjs');
const { mergeMap, withLatestFrom, map,share,shareReplay, filter,mapTo,take,debounceTime,throttle,throttleTime, startWith, takeWhile, delay, scan, distinct,distinctUntilChanged, tap, flatMap, takeUntil, toArray, groupBy} = require('rxjs/operators');
var mqtt = require('./mqttCluster.js');
global.mtqqLocalPath = 'mqtt://192.168.0.11';
var spawn = require('child_process').spawn;
var http = require('http');
const CronJob = require('cron').CronJob;
const {DateTime} = require('luxon');

const LED_LIGHTS_TOPIC = 'livingroom/wall/light/httpbrightnessvalue';
const FIRE_ON_TOPIC = 'livingroom/wall/fireplace/httpon';
const FIRE_OFF_TOPIC = 'livingroom/wall/fireplace/httpoff';
const FIRE_FLAME_CHANGE_TOPIC = 'livingroom/wall/fireplace/httpflamechange';

const LED_CONTROL = 'zigbee2mqtt/0x2c1165fffecad895';


const RM_IP = '192.168.0.9';
const RM_MAC = '780f77ec0ca4';
const FIRE_ON_IR_CODE = '2600880100012a591242121a131a1319121b121a1440123e1719131a111b111b131a121a121b121a121b13191419121a1143121a1440121b121a11431241131a12421241131a111b1419121a12421242121a121b121a111c1319121a13411242121a121b111b111c121a121a14401242121a131a121a121b121a121b11421341121a131a1319131a111b141911421341121b121a111c121a121a131a12421241131a121a131a121a131a121a12421242121a121b121a121a131a121a12421242121a131a121a121b121a121a12421242121a121b121a121b121a121b12411341121b121a121a131a121a121b12411341121b121a121b121a121a131a11431241131a121a131a121a111c121a11431241131a121a131a121a121b121a12421242121a121b121a121a13411242121a121b121a121b121a121b121a121a131a121a121b121a111c121a121b121a121a131a121a121b111b121b121a121a131a121a131a121a121b121a121b121a121b121a121a131a121a121b121a1242121b111b114213411341124212000d05';


console.log(`kitchen lights current time ${DateTime.now()}`);
global.mtqqLocalPath = 'mqtt://192.168.0.11';

  const sunRiseSetHourByMonth = {
    1:{
        sunRise: 9,
        sunSet: 16
    },
    2:{
        sunRise: 9,
        sunSet: 17
    },
    3:{
        sunRise: 8,
        sunSet: 18
    },
    4:{
        sunRise: 7,
        sunSet: 18
    },
    5:{
        sunRise: 6,
        sunSet: 20
    },
    6:{
        sunRise: 6,
        sunSet: 21
    },
    7:{
        sunRise: 6,
        sunSet: 21
    },
    8:{
        sunRise: 6,
        sunSet: 20
    },
    9:{
        sunRise: 6,
        sunSet: 19
    },
    10:{
        sunRise: 7,
        sunSet: 18
    },
    11:{
        sunRise: 8,
        sunSet: 17
    },
    12:{
        sunRise: 9,
        sunSet: 16
    },
}
  const everyHourStream =  new Observable(subscriber => {      
    new CronJob(
        `0 * * * *`,
       function() {
        subscriber.next(true);
       },
       null,
       true,
       'Europe/Dublin'
   );
  });
  const sharedHourStream = everyHourStream.pipe(share())
  const sunRiseStream = sharedHourStream.pipe(
    mapTo(sunRiseSetHourByMonth[DateTime.now().month].sunRise),
    filter(sunRiseHour => DateTime.now().hour === sunRiseHour),
    map(sunRiseHour => ({type:'sunRise',hour:sunRiseHour}))
    )
    const sunSetStream = sharedHourStream.pipe(
      mapTo(sunRiseSetHourByMonth[DateTime.now().month].sunSet),
      filter(sunSetHour => DateTime.now().hour === sunSetHour),
      map(sunSetHour => ({type:'sunSet',hour:sunSetHour}))
      )

  // When the sensor last saw someone (from the start, until it has), for the kitchen iPad:
  // its screen goes dark once the kitchen has been quiet for a while.
  let lastMotionAt = Date.now();

  const sensorStream = new Observable(async subscriber => {  
    var mqttCluster=await mqtt.getClusterAsync()   
    mqttCluster.subscribeData('zigbee2mqtt/0x142d41fffe24a424', function(content){   
      if (content.occupancy){      
        lastMotionAt = Date.now();
        subscriber.next(content)
    }
    });
  });



  const sharedSensorStream = sensorStream.pipe(
    share()
    )
const turnOffStream = sharedSensorStream.pipe(
    debounceTime(4 * 60 * 1000),
    mapTo("off"),
    share()
    )

const turnOnStream = sharedSensorStream.pipe(
    throttle(_ => turnOffStream),
    mapTo("on")
)
const autoOnOffStream = merge(turnOnStream,turnOffStream).pipe(
  map(e=> ({type:'auto', actionState:e==='on'}))

)


const buttonControl = new Observable(async subscriber => {  
  var mqttCluster=await mqtt.getClusterAsync()   
  mqttCluster.subscribeData('zigbee2mqtt/0x385cfbfffe05a8d8', function(content){   
          subscriber.next(content)
  });
});


const masterButtonStream = buttonControl.pipe(
  filter( c=>  c.action==='brightness_step_up' || c.action==='brightness_step_down' || c.action==='toggle'),
  map(c => {
    const {action} = c;
    if (action==='toggle') return { type:"toggle"} 
    else if (action==='brightness_step_down') return { type:"masterDown", value:c.action_step_size*5}  
    else if (action==='brightness_step_up')return { type:"masterUp", value:c.action_step_size*5}   
  })
)

// The slider on the kitchen iPad's home screen, a second control beside the knob: a
// brightness from 2 to 1000, or 0 for off until it is slid up again (like a knob press).
// The page asks GET /lights every 2 seconds and sends POST /lights {"brightness": n} when
// the finger lifts; nginx on the Pi (the screens container) passes both through to here.
const SCREEN_PORT = 8767;
const screenControl = new Subject();
const screenStream = screenControl.pipe(
  map(brightness => brightness === 0 ? { type:"screenOff" } : { type:"screenSet", value:brightness })
)

const initialState = {masterState:true, actionState:false, type: 'init', brightness:100};
let currentState = initialState;

const combinedStream = merge(autoOnOffStream,masterButtonStream,sunRiseStream,sunSetStream,screenStream).pipe(
  scan((acc, curr) => {
      if (curr.type==='toggle')  return {type:curr.type, masterState:!acc.masterState, actionState:!acc.masterState, brightness:100}
      if (curr.type==='masterDown')  return {type:curr.type, masterState:true, actionState:true, brightness: acc.brightness - curr.value < 2 ? 2 : acc.brightness - curr.value }
      if (curr.type==='masterUp')  return {type:curr.type, masterState:true, actionState:true, brightness: acc.brightness + curr.value > 1000 ? 1000 : acc.brightness + curr.value}
      if (curr.type==='sunRise') return {type:curr.type, masterState:false, actionState:false, brightness:acc.brightness}
      if (curr.type==='sunSet')  return {type:curr.type, masterState:true, actionState:acc.actionState, brightness:acc.brightness}
      if (curr.type==='auto')    return {type:acc.masterState ? curr.type : 'omit', masterState:acc.masterState, actionState:curr.actionState, brightness:acc.brightness}
      if (curr.type==='screenSet') return {type:curr.type, masterState:true, actionState:true, brightness:curr.value}
      if (curr.type==='screenOff') return {type:curr.type, masterState:false, actionState:false, brightness:acc.brightness}
      
  }, initialState),
  tap(state => { currentState = state }),
  filter(e => e.type!=='omit')
  
  );

// What the slider shows: the brightness, whether the lights are on right now, and whether
// motion is in charge (false after a knob press, sliding to off, or sunrise). Also how many
// seconds the motion sensor has been quiet, day or night, which the iPad's screen follows.
function screenState() {
  return {
    brightness: currentState.brightness,
    on: currentState.masterState && currentState.actionState,
    automatic: currentState.masterState,
    quietSeconds: Math.round((Date.now() - lastMotionAt) / 1000),
  };
}

http.createServer((req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url !== '/lights') return reply(404, { error: 'only /lights' });
  if (req.method === 'GET') return reply(200, screenState());
  if (req.method !== 'POST') return reply(405, { error: 'GET or POST /lights' });
  let body = '';
  req.on('data', chunk => { body += chunk });
  req.on('end', () => {
    let brightness;
    try { brightness = JSON.parse(body).brightness } catch (e) {}
    if (typeof brightness !== 'number' || !isFinite(brightness)) {
      return reply(400, { error: 'send {"brightness": 0 to 1000}' });
    }
    // Runs through the scan above at once, so the reply already has the new state.
    screenControl.next(brightness <= 0 ? 0 : Math.max(2, Math.min(1000, Math.round(brightness))));
    reply(200, screenState());
  });
}).listen(SCREEN_PORT, () => console.log(`slider requests on port ${SCREEN_PORT}`));


  combinedStream
.subscribe(async m => {
  console.log(m);
    if (m.actionState){
      (await mqtt.getClusterAsync()).publishMessage('kitchen/lights',m.brightness.toString());
    }
    else{
      (await mqtt.getClusterAsync()).publishMessage('kitchen/lights','0');
    }
})

