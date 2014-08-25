node-server-admin-SSH2
======================

Wrappers for [node.js](http://nodejs.org/) [SSH2](https://github.com/mscdex/ssh2) 

SSH2Shell
---------
This is a class that wraps the node.js SSH2 shell command enabling the following actions:

* Sudo and sudo su password prompt detection and response.
* Run multiple commands one after the other, detecting the previous command completion before running the next command.
* Detection of the current command and conditions within the response text before the next command is run.
* Adding or removing command/s to be run based on the result of command/response tests.
* Messages to output at different stages of the process. (connected, ready, command complete, all complete, connection closed)
* Current command and response text available to callback on command completion.
* Total response text at the connection close available to callback.
* Message format for commands object to enable two types of non-command output like a bash echo to full response text or output method.
* Use of ssh keys
