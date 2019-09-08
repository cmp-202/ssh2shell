var dotenv = require('dotenv'),
debug = true,
verbose = true
dotenv.load();

var host1 = {
server: {
		host:         process.env.HOST,
		port:         process.env.PORT,
		userName:     process.env.USER_NAME,
		password:     process.env.PASSWORD
	},
	connectedMessage:'connected to host1',
  debug: debug,
  verbose: verbose

};

var host2 = {
server: {
	  host:         process.env.SERVER2_HOST,
	  port:         process.env.PORT,
	  userName:     process.env.SERVER2_USER_NAME,
	  password:     process.env.SERVER2_PASSWORD
	 
	},
	connectedMessage: 'connected to host2',
  debug: debug,
  verbose: verbose
};

var host3 = {
server: {
	  host:         process.env.SERVER3_HOST,
	  port:         process.env.PORT,
	  userName:     process.env.SERVER3_USER_NAME,
	  password:     process.env.SERVER3_PASSWORD
	 
	},
	commands: ['echo server3'],
	connectedMessage:'connected to host3',
  debug: debug,
  verbose: verbose
};

host2.hosts = [host3];
host1.hosts = [host2];

var SSH2Shell = require ('../lib/ssh2shell'),

_SSH = new SSH2Shell(host1);

var callback = function( sessionText ){
          console.log ( "-----Callback session text:\n" + sessionText);
          console.log ( "-----Callback end" );
      }

_SSH.connect(callback);