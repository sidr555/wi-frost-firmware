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
    compr: {
      pin: 12
    },
    // comprFan: {
    //   pin: 13
    // },
    heater: {
      pin: 14
    }
  },
  job: {
    tLoop: 2
  }
};


let log = console.log;


function setRelay(name, on) {
  let r = conf.relays[name];
  if (r && r.pin && r.on !== on) {
    digitalWrite(r.pin, on);
    r.on = on;
    r.time = parseInt((new Date()).getTime()/1000);
    // log("setRelay", name, r);
    return true;
  }
  return false;
}



// Initialize DS18B20 temperature sensors and send statistics via WebSockets
const ow = new OneWire(conf.ow.pin);
let sensors = ow.search().reduce(function (res, id) {
  let d = require("DS18B20").connect(ow, id);
  let obj = {
    type: "unknown",
    dev: d,
    temp: null
  };

  // зададим интервал опроса датчиков
  let chk = () => {
    d.getTemp((temp) => {
      // log("Check temperature", id, temp);
      obj.temp = temp;
    });
  };

  chk();
  setInterval(chk, conf.ow.tCheck * 1000);

  res[id] = obj;
  return res;
}, {});

// Initialize WebSocket auto reconnection dispatcher
const WSDispatcher = require("dispatcher");
let ws = new WSDispatcher();

// Set some WS message handlers
ws.on("connect", () => {
  // ws.send("config");
  ws.send("limits");
  ws.send("sensors");
});

// ws.on("error", (err) => {
//   log("error handler", err);
// });

ws.on("close", () => {
  // log("close handler");
  setTimeout(() => {
    ws.connect();
  }, 3000)
});


// ws.on("config", (data) => {
//   // log("config handler", data);
//   conf.device = data;
// });
ws.on("sensors", (data) => {
  // log("sensors handler", data);
  // delete conf.sensors;
  conf.sensors = data;
  let s = Object.keys(conf.sensors).map((type) => {
     let id = conf.sensors[type];
     if (id && sensors[id]) {
       sensors[id].type = type;
     }
     return null;
  });

});
ws.on("limits", (data) => {
  // log("limits handler", data);
  conf.lims = data;
});



let wsT = 3000;
ws.connect((next) => {
  // log("Dispatcher connect");
  require("Wifi").connect("Keenetic-0186", {password:"R838rPfr"}, (err) => {
    if (!err) {
      // log("WiFi connected");

      // let w = new WebSocket(conf.api.host, {
      let w = new (require("ws"))(conf.api.host, {
        path: '/',
        port: conf.api.wsport,
        protocol: "echo-protocol",
        protocolVersion: 13,
        origin: 'Espruino',
        keepAlive: 600,
        //headers:{}
      });

      setTimeout(() => {
        if (!w.connected) {
          wsT *= 2;
          log("Reconnect WS in " + wsT / 1000 + "sec.");
          ws.connect();
        } else {
          wsT = 3000;
        }
      }, wsT);

      next(w);
    }
  });
});

// Periodically sends temperature to server
setInterval(() => {
  ws.send("temperature", Object.keys(sensors).map((id) => {
    return {
      type: sensors[id].type,
      id: id,
      temperature: sensors[id].temp
    };
  }));
}, conf.ow.tSend * 1000);



let Job = {
  name: "off",
  iLoop: null,
  setCompr(on) {
    let time = (new Date()).getTime()/1000;
    if (on && conf.relays.compr.time &&
         time - conf.relays.compr.time < conf.lims.compr_sleeptime) {
      return false;
    }
    return setRelay("compr", on);
  },

  setHeater(on, force) {
    let time = (new Date()).getTime()/1000;
    if (force || on || !conf.relays.heater.time || time - conf.relays.heater.time > conf.lims.heater_stop_minutes) {
      return setRelay("heater", on);
    }
  },

  run(name, logReason) {
    if (name === this.name) return;

    // if (this.iLoop) {
    //   clearInterval(this.iLoop);
    // }

    // Run given job
    if (name !== this.name) {
      switch (name) {
        case "sleep":
          if (this.setCompr(false) && this.setHeater(false, true)) {
            this.name = name;
            ws.send("job", name);
          }
          break;
        case "heat":
          if (this.setCompr(false) && this.setHeater(true)) {
            this.name = name;
            ws.send("job", name);
          }
          break;
        case "freeze":
          if (this.setHeater(false) && this.setCompr(true)) {
            this.name = name;
            ws.send("job", name);
          }
          break;
      }
      if (name === this.name) {
        log("RUN JOB", name, logReason);
        if (logReason) {
          ws.send("log", logReason);
        }
      }
    }

    // Run magic loop
    if (name === "on") {
      this.iLoop = setInterval(() => {

        let now = new Date(),
            time = parseInt(now.getTime() / 1000),
            hour = now.getHours(),
            temp = Object.keys(conf.sensors).reduce((obj, key) => {
              // console.log("temp", key, conf.sensors[key], sensors[conf.sensors[key]]);
              obj[key] = sensors[conf.sensors[key]] ? sensors[conf.sensors[key]].temp : false;
              return obj;
            }, {});

        // log("JOB LOOP", this.name, hour, temp);
        // Start heater on time
        if (this.name !== "heat" &&
            hour === conf.lims.heater_start_hour
        ) {
          // log("START HEATER ON TIME")
          return this.run("heat", ["heater_start_hour", hour]);
        }

        // Stop heater on time
        if (this.name === "heat" &&
            time - conf.relays.heater.start > conf.lims.heater_stop_minutes * 60
        ) {
          // log("STOP HEATER ON TIME")
          return this.run("sleep", ["heater_stop_minutes", hour]);
        }

        // Stop freezing on moroz temp < stop temp
        if (this.name === "freeze" &&
            temp.moroz && temp.moroz < conf.lims.moroz_stop_temp) {
          // log("STOP COMPRESSOR (GOOD MOROZ)")
          return this.run("sleep", ["moroz_stop_temp", temp.moroz]);
        }

        // Start freezing on moroz temp > start temp
        if (this.name !== "freeze" &&
            temp.moroz && temp.moroz > conf.lims.moroz_start_temp) {
          // log("START COMPRESSOR (LOW MOROZ)")
          return this.run("freeze", ["moroz_start_temp", temp.moroz]);
        }

        // Stop freezing on compressor temp > max temp
        if (this.name === "freeze" &&
            temp.compr && temp.compr > conf.lims.compr_max_temp) {
          // log("STOP COMPRESSOR (HIGH TEMP)")
          return this.run("sleep", ["compr_max_temp", temp.compr]);
        }

        // Warn on unit temp > max temp
        if (temp.unit && temp.unit > conf.lims.unit_max_temp) {
          // log("HIGH UNIT TEMP")
          ws.send("danger", ["unit_max_temp", temp.unit]);
        }

        // Start heater on delta temp
        if (this.name !== "heat" &&
            temp.body - temp.moroz > conf.lims.delta_temp) {
          // log("START HEATER (GOOD MOROZ AND LOW BODY TEMP)")
          return this.run("heat", ["delta_temp", temp.moroz, temp.body]);
        }

      }, conf.job.tLoop * 1000);
    }
  }
};
Job.run("on");
