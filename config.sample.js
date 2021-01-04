var config = require("./config")

var wifi = require("Wifi");
wifi.connect("my-ssid", {password:"my-pwd"}, function(ap){ console.log("connected:", ap); });


setInterval(function() {
  print("hello");
}, 1000);