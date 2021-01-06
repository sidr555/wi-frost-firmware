let conf = {
  api: {
    host: "192.168.0.41",
    wsport: "8051"
  },
  ow: {
    pin: 4,
    tCheck: 10,
    tSend: 30
  },
  relays: {
    compr: 12,
    // comprFan: 13
    heater: 14

  },
  job: {
    tLoop: 2
  }
};


let log = console.log;




// Initialize DS18B20 temperature sensors and send statistics via WebSockets

const ow = new OneWire(conf.ow.pin);
let sensors = ow.search().reduce(function (obj, id) {
  let d = require("DS18B20").connect(ow, id);
  obj[id] = {
    type: "unknown",
    dev: d,
    temp: null
  };
  return obj;
}, {});

// зададим интервал опроса датчиков
let checkTemp = () => {
  Object.keys(sensors).forEach((id) => {
    sensors[id].dev.getTemp((temp) => {
      // log("Check temperature", id, temp);
      sensors[id].temp = temp;
    });
  });
};
checkTemp();
setInterval(checkTemp, conf.ow.tCheck * 1000);





//
// // Initialize WebSocket auto reconnection dispatcher
const WSDispatcher = require("dispatcher");
let ws = new WSDispatcher();
//
// // Set some WS message handlers
// ws.on("connect", () => {
//   // ws.send("config");
//   ws.send("limits");
//   ws.send("sensors");
// });
//
// // ws.on("error", (err) => {
// //   log("error handler", err);
// // });
//
// ws.on("close", () => {
//   // log("close handler");
//   setTimeout(() => {
//     ws.connect();
//   }, 3000)
// });
//
//
// // ws.on("config", (data) => {
// //   // log("config handler", data);
// //   conf.device = data;
// // });
// ws.on("sensors", (data) => {
//   // log("sensors handler", data);
//   // delete conf.sensors;
//   conf.sensors = data;
//   let s = Object.keys(conf.sensors).map((type) => {
//      let id = conf.sensors[type];
//      if (id && sensors[id]) {
//        sensors[id].type = type;
//      }
//      return null;
//   });
//
// });
// ws.on("limits", (data) => {
//   // log("limits handler", data);
//   conf.lims = data;
// });
//
//
//
let wsT = 3000;
ws.connect((next) => {
  // log("Dispatcher connect");
  require("Wifi").connect("Keenetic-0186", {password:"R838rPfr"}, (err) => {
    if (!err) {
      // log("WiFi connected");

      // let w = new WebSocket(conf.api.host, {
      // let w = new (require("ws"))(conf.api.host, {
      //   path: '/',
      //   port: conf.api.wsport,
      //   protocol: "echo-protocol",
      //   protocolVersion: 13,
      //   origin: 'Espruino',
      //   keepAlive: 600,
      //   //headers:{}
      // });
      //
      // setTimeout(() => {
      //   if (!w.connected) {
      //     wsT *= 2;
      //     log("Reconnect WS in " + wsT / 1000 + "sec.");
      //     ws.connect();
      //   } else {
      //     wsT = 3000;
      //   }
      // }, wsT);
      //
      // next(w);
    }
  });
});

// Periodically sends temperature to server
// setInterval(() => {
//   ws.send("temperature", Object.keys(sensors).map((id) => {
//     return {
//       type: sensors[id].type,
//       id: id,
//       temperature: sensors[id].temp
//     };
//   }));
// }, conf.ow.tSend * 1000);


let now = require("now").Now;
let secFrom = require("now").Sec;
let Relay = require("relay");

let compressor = new Relay(conf.relays.compr, (on) => {
  return true;
  // return !on || secFrom(this.time) > conf.lims.compr_sleeptime
});

let heater = new Relay(conf.relays.heater, (on) => {
  return true;
  // return on || secFrom(this.time) > conf.lims.heater_stop_minutes
});



let worker = {
  job: "off",

  sleep:  (force) => compressor.off(force) && heater.off(true),
  heat:   (force) => compressor.off(force) && heater.on(force),
  freeze: (force) => heater.off(force) && compressor.on(force),
  start: () => {},

  run(job, force, reason) {
    // log("worker run job", job, force);
    if (job !== worker.job &&
        typeof worker[job] === "function" &&
        worker[job](force)) {

      worker.job = job;
      log("worker job started", worker.job, " compressor:", compressor.act ? "+" : "-", "heater:", heater.act ? "+" : "-");
      // ws.send("job", job);

      if (reason) {
        // ws.send("log", reason);
      }
    }
  },

  loop() {
    if (!conf.lims) return;

    let time = now(),
        hour = (new Date()).getHours(),
        temp = Object.keys(conf.sensors).reduce((obj, key) => {
          // console.log("temp", key, conf.sensors[key], sensors[conf.sensors[key]]);
          obj[key] = sensors[conf.sensors[key]] ? sensors[conf.sensors[key]].temp : false;
          return obj;
        }, {});

    log("JOB LOOP", worker.job, hour, temp);

    // Start heater on time
    if (worker.job !== "heat" && hour === conf.lims.heater_start_hour) {
      // log("START HEATER ON TIME")
      return worker.run("heat", false, ["heater_start_hour", hour]);
    }

    // Stop heater on time
    if (worker.job === "heat" && secFrom(this.heater.time) > conf.lims.heater_stop_minutes * 60) {
      // log("STOP HEATER ON TIME")
      return worker.run("sleep", false,["heater_stop_minutes", hour]);
    }

    // Stop freezing on moroz temp < stop temp
    if (worker.job === "freeze" && temp.moroz && temp.moroz < conf.lims.moroz_stop_temp) {
      // log("STOP COMPRESSOR (GOOD MOROZ)")
      return worker.run("sleep", ["moroz_stop_temp", temp.moroz]);
    }

    // Start freezing on moroz temp > start temp
    if (worker.job !== "freeze" &&
        temp.moroz && temp.moroz > conf.lims.moroz_start_temp) {
      // log("START COMPRESSOR (LOW MOROZ)")
      return worker.run("freeze", ["moroz_start_temp", temp.moroz]);
    }

    // Stop freezing on compressor temp > max temp
    if (worker.job === "freeze" &&
        temp.compr && temp.compr > conf.lims.compr_max_temp) {
      // log("STOP COMPRESSOR (HIGH TEMP)")
      return worker.run("sleep", ["compr_max_temp", temp.compr]);
    }

    // Warn on unit temp > max temp
    if (temp.unit && temp.unit > conf.lims.unit_max_temp) {
      // log("HIGH UNIT TEMP")
      // ws.send("warn", ["unit_max_temp", temp.unit]);
    }

    // Start heater on delta temp
    if (worker.job !== "heat" &&
        temp.body - temp.moroz > conf.lims.delta_temp) {
      // log("START HEATER (GOOD MOROZ AND LOW BODY TEMP)")
      return worker.run("heat", ["delta_temp", temp.moroz, temp.body]);
    }
  }
}


worker.run("start");
setTimeout(() => worker.run("freeze"), 5000);
setTimeout(() => worker.run("heat"), 8000);

setInterval(worker.loop, conf.job.tLoop * 1000);

// ws.on("setjob", (job) => {
//   log("setjob", job);
//   worker.run(job, true);
// });

let esp = require("ESP8266");
log("Free flash", esp.getFreeFlash());
esp.setCPUFreq(160);
log("State", esp.getState());
