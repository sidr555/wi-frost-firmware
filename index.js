const wifi = require("Wifi");
const WebSocket = require("ws");



let config = {
  wifi: {
    ssid: "Keenetic-0186",
    pass: "R838rPfr"
  },
  api: {
    // protocol: "http",
    host: "192.168.0.41",
    // port: "8050",
    wsport: "8051"
  },
  sensors: {
    temp: {
      pin: 4,
      checkInterval: 10,
      sendInterval: 30
    }
  },
  relays: {
    compressor: {
      pin: 12
      //active: false
    },
    compressorFan: {
      pin: 13
    },
    heater: {
      pin: 14
    // },
    // fan: {
    //   pin: 2
    // },
    // wifiButton: {
    //   pin: 2
    // },
    // fan: {
    //   pin: 2
    }
  }
};

let currentTask = "none";


function setRelay(name, isOn) {
  let relay = config.relays['name'];
  if (relay && relay.pin && relay.active !== isOn) {
    digitalWrite(relay.pin, isOn);
    relay.active = isOn;
    relay.time = parseInt((new Date()).getTime()/1000);
    console.log("setRelay", name, relay);
    return true;
  }
  return false;
}

function setCompressor(isOn) {
  if (isOn && config.relays.compressor.time &&
      (new Date()).getTime()/1000 - config.relays.compressor.time < config.limits.compressor_sleeptime) {
    return false;
  }
  return setRelay("compressor", isOn);
}

function setHeater(isOn) {
  return setRelay("heater", isOn);
}


// Initialize DS18B20 temperature sensors and send statistics via WebSockets
const ow = new OneWire(config.sensors.temp.pin);
let sensors = ow.search().reduce(function (sensors, id) {
  let device = require("DS18B20").connect(ow, id);
  let obj = {
    // id: id,
    type: "unknown",
    // device: device,
    temp: null,
  };

  // зададим интервал опроса датчиков
  let checker = () => {
    device.getTemp((temp) => {
      // console.log("Check temperature", id, temp);
      obj.temp = temp;
    });
  };

  checker();
  setInterval(checker, config.sensors.temp.checkInterval * 1000);

  sensors[id] = obj;
  return sensors;
}, {});

// setTimeout(() => {
//   console.log("sensors", sensors.length, sensors);
// }, 1000);





// Initialize WebSocket auto reconnection dispatcher
const WSDispatcher = require("dispatcher");
let socket = new WSDispatcher();

// Set some WS message handlers
socket.on("connect", () => {
  socket.send("config");
  socket.send("limits");
  socket.send("sensors");
});

// socket.on("error", (err) => {
//   console.log("error handler", err);
// });

socket.on("close", () => {
  // console.log("close handler");
  setTimeout(() => {
    socket.connect();
  }, 3000)
});


socket.on("config", (data) => {
  console.log("config handler", data);
  config.device = data;
});
socket.on("sensors", (data) => {
  console.log("sensors handler", data);
  // delete config.sensors;
  config.sensors = data;
  // config.sensors.moroz = "284d341104000093";
  // config.sensors.body = "28bf19110400009b";
  // for (let type in config.sensors) {
  //   if (config.sensors[type] && sensors[config.sensors[type]]) {
  //     sensors[config.sensors[type]].type = type;
  //   }
  // }
  Object.keys(config.sensors).map((type) => {
     let id = config.sensors[type];
     if (id && sensors[id]) {
       sensors[id].type = type;
     }
     return null;
  });

});
socket.on("limits", (data) => {
  console.log("limits handler", data);
  config.limits = data;
});


// wifi.connect(config.wifi.ssid, {
//   password:config.wifi.pass
// }, (err) => {
//   if (err) {
//     return this.error(err);
//   }
//   console.log("WiFi connected");
// });

let wsConnTimeout = 3000;
socket.connect((next) => {
  // console.log("Dispatcher connect");
  wifi.connect(config.wifi.ssid, {
    password:config.wifi.pass
  }, (err) => {
    if (err) {
      setTimeout(() => {
        wsConnTimeout *= 2;
        console.log("Cannot connect WS. Try in " + wsConnTimeout/1000 + "sec.")
        socket.connect();
      }, wsConnTimeout);

      return this.error(err);
    } else {
      console.log("WiFi connected");

      let ws = new WebSocket(config.api.host, {
        path: '/',
        port: config.api.wsport,
        protocol: "echo-protocol",
        protocolVersion: 13,
        origin: 'Espruino',
        keepAlive: 600,
        //headers:{}
      });

      setTimeout(() => {
        if (!ws.connected) {
          wsConnTimeout *= 2;
          console.log("Cannot connect WS. Try in " + wsConnTimeout / 1000 + "sec.")
          socket.connect();
        } else {
          wsConnTimeout = 3000;
        }
      }, wsConnTimeout);

      if (typeof next === "function") {
        next(ws)
      }
    }
  });
});

// Periodically sends temperature to server
setInterval(() => {
  socket.send("temperature", Object.keys(sensors).map((id) => {
    return {
      type: sensors[id].type,
      id: id,
      temperature: sensors[id].temp
    };
  }));
}, config.sensors.temp.sendInterval * 1000);






// Main magick
let magick = () => {

  let temp = Object.keys(config.sensors).reduce((obj, key) => {
    obj[key] = sensors[config.sensors[key]] ? sensors[config.sensors[key]].temp : false;
    return obj;
  }, {});

  let now = new Date();
  let hour = now.getHours();

  console.log("LOOP", hour, temp);
  return;


  if (currentTask !== "freeze" &&
      temp.moroz && temp.moroz < config.limits.moroz_min_temp &&
      config.relays.compressor > config.limits.compressor_min_sleep) {

    setHeater(false);
    currentTask = setCompressor(true) ? "freeze" : "sleep";

    socket.send("log", ["moroz_min_temp", temp.moroz]);
    socket.send("task", currentTask);
  }

  if (currentTask !== "sleep" &&
      temp.compressor && temp.compressor > config.limits.compressor_max_temp) {

    if (currentTask === "heat") {
      setHeater(false);
    }

    setCompressor(false);
    currentTask = "sleep";

    socket.send("task", currentTask);
    socket.send("danger", ["compressor_max_temp", temp.compressor]);
  }

  if (temp.unit && temp.unit > config.limits.unit_max_temp) {
    socket.send("danger", ["unit_max_temp", temp.unit]);
  }

  // Start heater on delta temp
  if (currentTask !== "heat" &&
      temp.body - temp.moroz > config.limits.delta_temp) {

    setCompressor(false);
    currentTask = setHeater(true) ? "heat" : "sleep";

    socket.send("task", currentTask);
    socket.send("danger", ["delta_temp", temp.body, temp.moroz]);
  }


  // Start heater on time
  if (currentTask !== "heat" &&
      hour >= config.limits.heater_start_hour &&
      hour < config.limits.heater_start_hour + 1
  ) {
    setCompressor(false);
    currentTask = setHeater(true) ? "heat" : "sleep";

    socket.send("task", currentTask);
  }


  // Stop heater on time
  if (currentTask === "heat" &&
      config.relays.heater.start > config.limits.heater_stop_minutes
  ) {
    setHeater(false);
    currentTask = setCompressor(true) ? "freeze" : "sleep";

    socket.send("task", currentTask);
  }
}

setTimeout(magick, 7000);




