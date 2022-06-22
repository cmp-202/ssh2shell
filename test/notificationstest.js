var dotenv = require('dotenv').config()

var host = {
  server:             {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD
  },
  commands: [
    //hubot throwback
    "msg: using msg.send",
    "`All done!`",
  ],
  msg: {
    send: function( message ) {
      console.log(message);
    }
  },
  verbose: false,
  debug: false
};
  
//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(host);

var callback = function( sessionText ){
  //show the full session output. This could be emailed or saved to a log file.
  console.log("\nThis is the full session response: \n\n" + sessionText);
}

SSH.connect(callback);

