const { Observable,merge,timer, interval } = require('rxjs');
const { mergeMap, withLatestFrom, map,share,shareReplay, filter,mapTo,take,debounceTime,throttle,throttleTime, startWith, takeWhile, delay, scan, distinct,distinctUntilChanged, tap, flatMap, takeUntil, toArray, groupBy} = require('rxjs/operators');
var mqtt = require('./mqttCluster.js');
global.mtqqLocalPath = 'mqtt://192.168.0.11';
var spawn = require('child_process').spawn;
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
        sunSet: 19
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

  const sensorStream = new Observable(async subscriber => {  
    var mqttCluster=await mqtt.getClusterAsync()   
    mqttCluster.subscribeData('zigbee2mqtt/0x142d41fffe24a424', function(content){   
      if (content.occupancy){      
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
  mqttCluster.subscribeData('zigbee2mqtt/0x04cd15fffe58b077', function(content){   
          subscriber.next(content)
  });
});


const masterButtonStream = buttonControl.pipe(
  filter( c=>  c.action==='off'),
  mapTo({type:'master'})
)

const combinedStream = merge(autoOnOffStream,masterButtonStream,sunRiseStream,sunSetStream).pipe(
  scan((acc, curr) => {
      if (curr.type==='master')  return {type:curr.type, masterState:!acc.masterState, actionState:!acc.masterState}
      if (curr.type==='sunRise') return {type:curr.type, masterState:false, actionState:false}
      if (curr.type==='sunSet')  return {type:curr.type, masterState:true, actionState:acc.actionState}
      if (curr.type==='auto')    return {type:acc.masterState ? curr.type : 'omit', masterState:acc.masterState, actionState:curr.actionState}
      
  }, {masterState:false, actionState:false, type: 'init'}),
  filter(e => e.type!=='omit')
  
  );


  combinedStream
.subscribe(async m => {
  console.log(m);
    if (m.actionState){
      (await mqtt.getClusterAsync()).publishMessage('kitchen/lights','25');
    }
    else{
      (await mqtt.getClusterAsync()).publishMessage('kitchen/lights','0');
    }
})

