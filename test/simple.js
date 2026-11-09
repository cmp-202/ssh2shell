var dotenv = require('dotenv').config()
const fs = require('fs');
fs.writeFile('output.txt', "", (err) => {
    if (err) throw err; 
});
var host = {
  server: {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD
  },
  commands: 	  ["echo basic test success"],
  debug: (process.env.DEBUG === "true"),
  verbose: (process.env.VERBOSE === "true"),/*
  msg: function(message) {
      console.log(message);
    }*/
  msg: function(message){
    const formattedMessage = typeof message === 'object' && message !== null 
    ? JSON.stringify(message, (key, value) => {
        // If the property is a function, turn it into a descriptive string placeholder
        if (typeof value === 'function') {
          return `[Function: ${value.name || 'anonymous'}]`;
        }
        return value;
      }, 2) 
    : message;
    fs.appendFile('log.txt', `${formattedMessage}\n`, (err) => {
      if (err) throw err;
    });    
    
  }
}

var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(host),
    callback = function( sessionText ){
          console.log ( "-----Callback session text:\n" + sessionText);
          console.log ( "-----Callback end" );
      }

SSH.connect(callback)