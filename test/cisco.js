var host = {
    server: {
        host: 'conft.eu',
        port: 22,
        userName: 'cisco',
        password: 'cisco'
   },
    commands: [
        "msg:Doing something",
        "show clock",
        "sh ip int brief"
    ],
    msg: {
        send: function (message) {
            console.log(message);
        }
    },
	debug: true
};

//Create a new instance
var SSH2Shell = require ('../lib/ssh2shell'),
      SSH           = new SSH2Shell(host);

//add global event handlers to the SSH instance
SSH.on('end', function (sessionText, sshObj) {
    console.log("End event: " + sessionText);
});
console.log(SSH);
//Start the process
SSH.connect();