const { Observable,merge,timer } = require('rxjs');
const { mergeMap, map,share,filter,mapTo,take,debounceTime,throttle,throttleTime} = require('rxjs/operators');
var mqtt = require('./mqttCluster.js');
const {DateTime} = require('luxon');





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

global.mtqqLocalPath = process.env.MQTTLOCAL;
//global.mtqqLocalPath = 'mqtt://piscos.tk';


const KEEPLIGHTONFORSECS = 120 * 1000

const DOOR_SENSOR_TOPIC = process.env.DOOR_SENSOR_TOPIC
//const DOOR_SENSOR_TOPIC = 'rflink/EV1527-001c4e'

const OUTDOOR_SENSOR_TOPIC = process.env.OUTDOOR_SENSOR_TOPIC
//const OUTDOOR_SENSOR_TOPIC = 'rflink/EV1527-0a3789'




console.log(`starting entrance lights current time ${DateTime.now()}`)

const doorEntranceSensor = new Observable(async subscriber => {  
    var mqttCluster=await mqtt.getClusterAsync()   
    mqttCluster.subscribeData(DOOR_SENSOR_TOPIC, function(content){     
        if (!content.contact)   {
            subscriber.next({content})
        }
    });
});

const outdoorSensor = new Observable(async subscriber => {  
    var mqttCluster=await mqtt.getClusterAsync()   
    mqttCluster.subscribeData(OUTDOOR_SENSOR_TOPIC, function(content){        
        if (content.occupancy){      
            console.log(`motion detected`);
            subscriber.next({content})
        }
    });
});

const movementSensorsReadingStream = merge(doorEntranceSensor,outdoorSensor)



const sharedSensorStream = movementSensorsReadingStream.pipe(
    filter(_ => 
        DateTime.now().hour < sunRiseSetHourByMonth[DateTime.now().month].sunRise || 
        DateTime.now().hour >= sunRiseSetHourByMonth[DateTime.now().month].sunSet),
    share()
    )
const turnOffStream = sharedSensorStream.pipe(
    debounceTime(KEEPLIGHTONFORSECS),
    mapTo("off"),
    share()
    )

const turnOnStream = sharedSensorStream.pipe(
    throttle(_ => turnOffStream),
    mapTo("on")
)

merge(turnOnStream,turnOffStream)
.subscribe(async m => {
    console.log(m);
    (await mqtt.getClusterAsync()).publishMessage('esp/front/door/light',m)
})


