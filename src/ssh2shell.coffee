#================================
#  SSH2Shel
#================================
# Description
# SSH2 wrapper for creating a SSH shell connection and running multiple commands sequentially.

EventEmitter = require('events').EventEmitter

class SSH2Shell extends EventEmitter
  sshObj:        {}
  command:       ""
  _stream:       {}
  _data:         ""
  _buffer:       ""
  _connections:  [] 
  _timedout: =>
    @.emit 'commandTimeout', @command, @_buffer, @_stream, @connection

  _processData: ( data )=>
    #remove non-standard ascii from terminal responses
    data = data.replace(/[^\r\n\x20-\x7e]/g, "")
    #remove other weird nonstandard char representation from responses like [32m[31m
    data = data.replace(/(\[[0-9]?[0-9][a-zA-Z])/g, "")
    @_buffer += data
    
    #@.emit 'msg', "#{@sshObj.server.host}: #{@_buffer}" if @sshObj.debug

    #check if sudo password is needed
    if @command and @command.indexOf("sudo ") isnt -1    
      @_processPasswordPrompt()
    #check if ssh authentication needs to be handled
    else if @command and @command.indexOf("ssh ") isnt -1
      @_processSSHPrompt()
    #Command prompt so run the next command
    else if @standardPromt.test(@_buffer)
      @.emit 'msg', "#{@sshObj.server.host}: normal prompt" if @sshObj.debug
      @_processNextCommand()
    #command still processing
    else
      @.emit 'commandProcessing' , @command, @_buffer, @sshObj, @_stream 
      clearTimeout @_idleTimer if @_idleTimer
      @_idleTimer = setTimeout(@_timedout, @_idleTime)

  _processPasswordPrompt: =>
    #First test for password prompt
     
    unless @sshObj.pwSent      
      #when the buffer is fully loaded the prompt can be detected
      if @passwordPromt.test(@_buffer)
        @.emit 'msg', "#{@sshObj.server.host}: Send password [#{@sshObj.server.password}]" if @sshObj.debug
        @sshObj.pwSent = true
        @_stream.write "#{@sshObj.server.password}\n"        
      #normal prompt so continue with next command
      else if @standardPromt.test(@_buffer)
        @_processNextCommand()
        
    #normal prompt so continue with next command
    else if @standardPromt.test(@_buffer)
      @_processNextCommand()
      
    #password sent so either check for failure or run next command  
    else
      #reprompted for password again so failed password 
      if @passwordPromt.test(@_buffer)  
        @.emit 'msg', "#{@sshObj.server.host}: Error: Sudo password was incorrect for #{@sshObj.server.userName}, leaving host."
        @.emit 'msg', "#{@sshObj.server.host}: password: [#{@sshObj.server.password}]" if @sshObj.debug
        #add buffer to sessionText so the sudo response can be seen
        @sshObj.sessionText += "#{@_buffer}"
        @_buffer = ""
        @sshObj.commands = []
        @_stream.write '\x03'

  _processSSHPrompt: =>
    #not authenticated yet so detect prompts
    unless @sshObj.sshAuth
      #provide password
      if @passwordPromt.test(@_buffer)
        @.emit 'msg', "#{@sshObj.server.host}: ssh password prompt" if @sshObj.debug
        @sshObj.sshAuth = true
        @_stream.write "#{@sshObj.server.password}\n"
      #provide passphrase
      else if @passphrasePromt.test(@_buffer)
        @.emit 'msg', "#{@sshObj.server.host}: ssh passphrase prompt" if @sshObj.debug
        @sshObj.sshAuth = "true"
        @_stream.write "#{@sshObj.server.passPhrase}\n"
      #normal prompt so continue with next command
      else if @standardPromt.test(@_buffer)
        @.emit 'msg', "ssh auth normal prompt" if @sshObj.debug
        @sshObj.sshAuth = true        
        @sshObj.sessionText += "Connected to #{@sshObj.server.host}\n"
        @_processNextCommand()
    else 
      #detect failed authentication
      if (password = (@passwordPromt.test(@_buffer) or @passphrasePromt.test(@_buffer)))
        @sshObj.sshAuth = false
        @.emit 'msg', "Error: SSH authentication failed for #{@sshObj.server.userName}@#{@sshObj.server.host}"
        if @sshObj.debug
          @.emit 'msg', "Using " + (if password then "password: [#{@sshObj.server.password}]" else "passphrase: [#{@sshObj.server.passPhrase}]")
        #no connection so drop back to first host settings if there was one
        if @_connections.length > 0
          @sshObj = @_connections.pop()
        #add buffer to sessionText so the ssh response can be seen
        @sshObj.sessionText += "#{@_buffer}"
        #send ctrl-c to exit authentication prompt
        @_stream.write '\x03'
 
      #normal prompt so continue with next command
      else if @passwordPromt.test(@_buffer)
        @.emit 'msg', "ssh normal prompt" if @sshObj.debug
        @sshObj.sessionText += "Connected to #{@sshObj.server.host}\n"
        @_processNextCommand()
        
  _processNotifications: =>
    #check for notifications in commands
    while @command and ((sessionNote = @command.match(/^`(.*)`$/)) or (msgNote = @command.match(/^msg:(.*)$/)))
      #this is a message for the sessionText like an echo command in bash
      if sessionNote
        @sshObj.sessionText += "#{@sshObj.server.host}: #{sessionNote[1]}\n"
        @.emit 'msg', sessionNote[1] if @sshObj.verbose

      #this is a message to output in process
      else if msgNote
        @.emit 'msg', "#{@sshObj.server.host}: #{msgNote[1]}"
      
      #load the next command and repeat the checks
      if @sshObj.commands.length > 0
        @command = @sshObj.commands.shift()
      else
        @command = false

  _processNextCommand: =>
    #check sudo su has been authenticated and add an extra exit command
    if @command.indexOf("sudo su") isnt -1
      @sshObj.exitCommands.push "exit" 
      
    if @command isnt "" and @command isnt "exit" and @command.indexOf("ssh ") is -1
      #Not running an exit command and buffer complete so process it before next command
      @sshObj.sessionText += @_buffer
      
    @.emit 'commandComplete', @command, @_buffer, @sshObj
    @.emit 'msg', "#{@sshObj.server.host} verbose:#{@_buffer}" if @sshObj.verbose 
    @_buffer = ""
    
    #process the next command if there are any
    if @sshObj.commands.length > 0
      @command = @sshObj.commands.shift()
      #process notification commands
      @_processNotifications()
      
      #if there is still a command to run then run it or exit
      if @command
        @_runCommand()
      else
        #no more commands so exit
        @_runExit()
    else
      #no more commands so exit
      @_runExit()
         
  _runCommand: =>
    @.emit 'msg', "#{@sshObj.server.host}: next command: #{@command}" if @sshObj.debug
    @_stream.write "#{@command}\n"
    
  _nextHost: =>
    @_buffer = ""
    @nextHost = @sshObj.hosts.shift()
    @.emit 'msg', "#{@sshObj.server.host}: ssh to #{@nextHost.server.host}" if @sshObj.debug  
    @_connections.push @sshObj
    @sshObj = @nextHost
    @_loadDefaults()
    if @sshObj.hosts and @sshObj.hosts.length is 0
      @sshObj.exitCommands.push "exit"
    @sshObj.commands.unshift("ssh -oStrictHostKeyChecking=no #{@sshObj.server.userName}@#{@sshObj.server.host}")
    @_processNextCommand()
 
  _runExit: =>
    #run the exit commands loaded by ssh and sudo su commands
    if @sshObj.exitCommands and @sshObj.exitCommands.length > 0
      @.emit 'msg', "#{@sshObj.server.host}: Queued exit commands: #{@sshObj.exitCommands}" if @sshObj.debug
      @command = @sshObj.exitCommands.pop()
      @_runCommand()
    #more hosts to connect to so process the next one
    else if @sshObj.hosts and @sshObj.hosts.length > 0
      @.emit 'msg', "\n#{@sshObj.server.host}: Queued hosts for this host:" if @sshObj.debug
      @.emit 'msg', @sshObj.hosts if @sshObj.debug
      @_nextHost()
    #Leaving last host so load previous host 
    else if @_connections and @_connections.length > 0
      @.emit 'msg', "\nParked hosts:" if @sshObj.debug
      @.emit 'msg', @_connections if @sshObj.debug
      @.emit 'end', @sshObj.sessionText, @sshObj
      @sshObj = @_connections.pop()
      @.emit 'msg', "loaded previous host object for: #{@sshObj.server.host}" if @sshObj.debug
      if @_connections.length > 0
        @sshObj.exitCommands.push "exit"
      @_processNextCommand()
    #Nothing more to do so end the stream with last exit
    else
      @.emit 'msg', "Exit and close connection on: #{@sshObj.server.host}" if @sshObj.debug
      @_stream.end "exit\n"
      
  _loadDefaults: =>
    @sshObj.msg = { send: ( message ) =>
      console.log message
    } unless @sshObj.msg
    @sshObj.connectedMessage = "Connected" unless @sshObj.connectedMessage
    @sshObj.readyMessage = "Ready" unless @sshObj.readyMessage
    @sshObj.closedMessage = "Closed" unless @sshObj.closedMessage
    @sshObj.verbose = false unless @sshObj.verbose
    @sshObj.debug = false unless @sshObj.debug
    @sshObj.hosts = [] unless @sshObj.hosts 
    @sshObj.standardPrompt = ">$%#" unless @sshObj.standardPrompt
    @sshObj.passwordPromt = ":" unless @sshObj.passwordPromt
    @sshObj.passphrasePromt = ":" unless @sshObj.passphrasePromt
    @sshObj.exitCommands = []
    @sshObj.pwSent = false
    @sshObj.sshAuth = false
    @_idleTime = @sshObj.idleTimeOut ? 5000
    @passwordPromt = new RegExp("password.*" + @sshObj.passwordPromt + "\\s$","i");
    @passphrasePromt = new RegExp("password.*" + @sshObj.passphrasePromt + "\\s$","i");
    @standardPromt = new RegExp("[" + @sshObj.standardPrompt + "]\\s$");
    
  constructor: (@sshObj) ->
    @_loadDefaults()
    
    @connection = new require('ssh2')()
    
    #event handlers
    @.on "connect", =>
      @.emit 'msg', @sshObj.connectedMessage

    @.on "ready", =>
      @.emit 'msg', @sshObj.readyMessage
    
    @.on "msg", ( message ) =>
      if @sshObj.msg
        @sshObj.msg.send message
        
    @.on 'commandProcessing', ( command, response, sshObj, stream ) =>
      if @sshObj.onCommandProcessing
        @sshObj.onCommandProcessing command, response, sshObj, stream
    
    @.on 'commandComplete', ( command, response, sshObj ) =>
      if @sshObj.onCommandComplete
        @sshObj.onCommandComplete command, response, sshObj
    
    @.on 'commandTimeout', ( command, response, stream, connection ) =>
      if @sshObj.onCommandTimeout
        @sshObj.onCommandTimeout command, response, stream, connection
      else
        @.emit "error", "#{@sshObj.server.host}: Command timed out after #{@_idleTime/1000} seconds", "Timeout", true, (err, type)=>
          @sshObj.sessionText += @_buffer
    
    @.on 'end', ( sessionText, sshObj ) =>
      if @sshObj.onEnd
        @sshObj.onEnd sessionText, sshObj

    @.on "close", (had_error) =>
      if had_error
        @.emit "error", had_error, "Close"
      else
        @.emit 'msg', @sshObj.closedMessage
    
    @.on "error", (err, type, close = false, callback) =>
      @.emit 'msg', "#{type} error: " + err
      callback(err, type) if callback
      @connection.end() if close
      
  connect: ()=>
    if @sshObj.server and @sshObj.commands
      try
        @connection.on "connect", =>
          @.emit "connect"

        @connection.on "ready", =>
          @.emit "ready"

          #open a shell
          @connection.shell { pty: true }, (err, @_stream) =>
            if err then @.emit 'error', err, "Shell", true
            @sshObj.sessionText = "Connected to #{@sshObj.server.host}\n"
            
            @_stream.on "error", (err) =>
              @.emit 'error', err, "Stream"

            @_stream.stderr.on 'data', (data) =>
              @.emit 'stderr', data, "Stream STDERR"
              
            @_stream.on "readable", =>
              try
                while (data = @_stream.read())
                  @_processData( "#{data}" )
              catch e
                @.emit 'error', "#{e} #{e.stack}", "Processing response:", true
                
            @_stream.on "end", =>
              #run the on end callback function
              @.emit 'end', @sshObj.sessionText, @sshObj
            
            @_stream.on "close", (code, signal) =>
              clearTimeout @_idleTimer if @_idleTimer
              @connection.end()
          
        @connection.on "error", (err) =>
          @.emit "error", err, "Connection", true
          
        @connection.on "close", (had_error) =>
          @.emit "close", had_error

        @connection.connect
          host:       @sshObj.server.host
          port:       @sshObj.server.port
          username:   @sshObj.server.userName
          password:   @sshObj.server.password
          privateKey: @sshObj.server.privateKey ? ""
          passphrase: @sshObj.server.passPhrase ? ""

      catch e
        @.emit 'error', "#{e} #{e.stack}", "Connect:", true
        
    else
      @.emit 'error', "Missing connection parameters", "Parameters", false, missingParameters( err, type, close ) ->
        @.emit 'msg', @sshObj.server
        @.emit 'msg', @sshObj.commands

module.exports = SSH2Shell
