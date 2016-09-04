#================================
#  SSH2Shel
#================================
# Description
# SSH2 wrapper for creating a SSH shell connection and running multiple commands sequentially.

EventEmitter = require('events').EventEmitter

class SSH2Shell extends EventEmitter
  sshObj:         {}
  command:        ""
  _stream:        {}
  _data:          ""
  _buffer:        ""
  _connections:   []
  idleTime:       5000
  asciiFilter:    ""
  textColorFilter:""
  passwordPromt:  ""
  passphrasePromt:""
  standardPromt:  ""
  
  _setCommandTimer: =>
    
    
  _processData: ( data )=>
    #remove non-standard ascii from terminal responses
    data = data.replace(@asciiFilter, "")
    #remove test coloring from responses like [32m[31m
    unless @sshObj.disableColorFilter
      data = data.replace(@textColorFilter, "")
    
    #add host response data to buffer
    @_buffer += data

    #check if sudo password is needed
    if @command and @command.indexOf("sudo ") isnt -1    
      @_processPasswordPrompt()
    #check if ssh authentication needs to be handled
    else if @command and @command.indexOf("ssh ") isnt -1
      @_processSSHPrompt()
    #Command prompt so run the next command
    else if @standardPromt.test(@_buffer)
      @.emit 'msg', "#{@sshObj.server.host}: normal prompt detected" if @sshObj.debug
      @sshObj.pwSent = false #reset sudo prompt checkable
      @_processNextCommand()
    #command still processing
    else
      @.emit 'commandProcessing' , @command, @_buffer, @sshObj, @_stream 
      #@_setCommandTimer() 
      #self = @
      clearTimeout @sshObj.idleTimer if @sshObj.idleTimer
      @sshObj.idleTimer = setTimeout( =>
        @.emit 'commandTimeout', @.command, @._buffer, @._stream, @._connection
      , @idleTime)

  _processPasswordPrompt: =>
    #First test for password prompt
     
    unless @sshObj.pwSent      
      #when the buffer is fully loaded the prompt can be detected
      if @passwordPromt.test(@_buffer)
        @.emit 'msg', "#{@sshObj.server.host}: Send password [#{@sshObj.server.password}]" if @sshObj.debug
        @sshObj.pwSent = true
        @_stream.write "#{@sshObj.server.password}#{@sshObj.enter}"        
      #normal prompt so continue with next command
      else if @standardPromt.test(@_buffer)
        @.emit 'msg', "#{@sshObj.server.host}: Standard prompt after password sent" if @sshObj.debug
        @_processNextCommand()
        
    #normal prompt so continue with next command
    else if @standardPromt.test(@_buffer)
      @.emit 'msg', "#{@sshObj.server.host}: Standard prompt detected" if @sshObj.debug
      @_processNextCommand()
      
    #password sent so either check for failure or run next command  
    else
      #reprompted for password again so failed password 
      if @passwordPromt.test(@_buffer)  
        @.emit 'error', "Sudo password was incorrect for #{@sshObj.server.userName}, leaving host.", "Sudo authentication"
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
        @_stream.write "#{@sshObj.server.password}#{@sshObj.enter}"
      #provide passphrase
      else if @passphrasePromt.test(@_buffer)
        @.emit 'msg', "#{@sshObj.server.host}: ssh passphrase prompt" if @sshObj.debug
        @sshObj.sshAuth = "true"
        @_stream.write "#{@sshObj.server.passPhrase}#{@sshObj.enter}"
      #normal prompt so continue with next command
      else if @standardPromt.test(@_buffer)
        @.emit 'msg', "#{@sshObj.server.host}: ssh auth normal prompt" if @sshObj.debug
        @sshObj.sshAuth = true        
        @sshObj.sessionText += "Connected to #{@sshObj.server.host}#{@sshObj.enter}"
        @_processNextCommand()
    else 
      #detect failed authentication
      if (password = (@passwordPromt.test(@_buffer) or @passphrasePromt.test(@_buffer)))
        @sshObj.sshAuth = false
        @.emit 'error', "SSH authentication failed for #{@sshObj.server.userName}@#{@sshObj.server.host}", "Nested host authentication"
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
        @.emit 'msg', "#{@sshObj.server.host}: ssh normal prompt" if @sshObj.debug
        @sshObj.sessionText += "Connected to #{@sshObj.server.host}#{@sshObj.enter}"
        @_processNextCommand()
        
  _processNotifications: =>
    #check for notifications in commands
    while @command and ((sessionNote = @command.match(/^`(.*)`$/)) or (msgNote = @command.match(/^msg:(.*)$/)))
      #this is a message for the sessionText like an echo command in bash
      if sessionNote
        @sshObj.sessionText += "#{@sshObj.server.host}: #{sessionNote[1]}#{@sshObj.enter}"
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
      #Not running an exit command or first prompt detection after connection
      #load the full buffer into sessionText and raise a commandComplete event
      @sshObj.sessionText += @_buffer
    
    @.emit 'commandComplete', @command, @_buffer, @sshObj
      
    @.emit 'msg', "#{@sshObj.server.host}:command: #{@command}#{@sshObj.enter}response: #{@_buffer}" if @sshObj.verbose 
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
    @_stream.write "#{@command}#{@sshObj.enter}"
    
  _nextHost: =>
    @_buffer = ""
    @nextHost = @sshObj.hosts.shift()
    @.emit 'msg', "#{@sshObj.server.host}: ssh to #{@nextHost.server.host}" if @sshObj.debug  
    @_connections.push @sshObj
    @sshObj = @nextHost
    @_loadDefaults()
    if @sshObj.hosts and @sshObj.hosts.length is 0
      @sshObj.exitCommands.push "exit"
    @sshObj.commands.unshift("#{@sshObj.server.host}: ssh -oStrictHostKeyChecking=no #{@sshObj.server.userName}")
    @_processNextCommand()
 
  _runExit: =>
    #run the exit commands loaded by ssh and sudo su commands
    if @sshObj.exitCommands and @sshObj.exitCommands.length > 0
      @.emit 'msg', "#{@sshObj.server.host}: Queued exit commands: #{@sshObj.exitCommands}" if @sshObj.debug
      @command = @sshObj.exitCommands.pop()
      @_runCommand()
    #more hosts to connect to so process the next one
    else if @sshObj.hosts and @sshObj.hosts.length > 0
      @.emit 'msg', "#{@sshObj.server.host}: Queued hosts for this host" if @sshObj.debug
      @.emit 'msg', @sshObj.hosts if @sshObj.debug
      @_nextHost()
    #Leaving last host so load previous host 
    else if @_connections and @_connections.length > 0
      @.emit 'msg', "#{@sshObj.enter}Parked hosts:" if @sshObj.debug
      @.emit 'msg', @_connections if @sshObj.debug
      @.emit 'end', @sshObj.sessionText, @sshObj
      @sshObj = @_connections.pop()
      @.emit 'msg', "#{@sshObj.server.host}: Loaded previous host object" if @sshObj.debug
      if @_connections.length > 0
        @sshObj.exitCommands.push "exit"
      @_processNextCommand()
    #Nothing more to do so end the stream with last exit
    else
      @.emit 'msg', "#{@sshObj.server.host}: Exit and close connection" if @sshObj.debug
      @.command = "exit"
      @_stream.end "exit#{@sshObj.enter}"
      
  _loadDefaults: =>
    @sshObj.msg = { send: ( message ) =>
      console.log message
    } unless @sshObj.msg
    @sshObj.connectedMessage  = "Connected" unless @sshObj.connectedMessage
    @sshObj.readyMessage      = "Ready" unless @sshObj.readyMessage
    @sshObj.closedMessage     = "Closed" unless @sshObj.closedMessage
    @sshObj.verbose           = false unless @sshObj.verbose
    @sshObj.debug             = false unless @sshObj.debug
    @sshObj.hosts             = [] unless @sshObj.hosts 
    @sshObj.standardPrompt    = ">$%#" unless @sshObj.standardPrompt
    @sshObj.passwordPromt     = ":" unless @sshObj.passwordPromt
    @sshObj.passphrasePromt   = ":" unless @sshObj.passphrasePromt
    @sshObj.enter             = "\n" unless @sshObj.enter #windows = "\r\n", Linux = "\n", Mac = "\r"
    @sshObj.asciiFilter       = "[^\r\n\x20-\x7e]" unless @sshObj.asciiFilter
    @sshObj.disableColorFilter = false unless @sshObj.disableColorFilter
    @sshObj.textColorFilter   = "(\x1b\[[0-9;]*m)" unless @sshObj.textColorFilter
    @sshObj.exitCommands      = []
    @sshObj.pwSent            = false
    @sshObj.sshAuth           = false
    @sshObj.server.hashKey    = @sshObj.server.hashKey ? ""
    @idleTime                 = @sshObj.idleTimeOut ? 5000
    @asciiFilter              = new RegExp(@sshObj.asciiFilter,"g")
    @textColorFilter          = new RegExp(@sshObj.textColorFilter,"g")
    @passwordPromt            = new RegExp("password.*" + @sshObj.passwordPromt + "\\s?$","i")
    @passphrasePromt          = new RegExp("password.*" + @sshObj.passphrasePromt + "\\s?$","i")
    @standardPromt            = new RegExp("[" + @sshObj.standardPrompt + "]\\s?$")
    
  constructor: (@sshObj) ->
    @_loadDefaults()
    
    @connection = new require('ssh2')()
    
    #event handlers
    @.on "keyboard-interactive", (name, instructions, instructionsLang, prompts, finish) =>
      @.emit 'msg', "#{@sshObj.server.host}: this.onKeyboardInteractive" if @sshObj.debug
      
    @.on "connect",  =>
      @.emit 'msg', @sshObj.connectedMessage ? "Connected"
      
    @.on "ready",  =>
      @.emit 'msg', @sshObj.readyMessage ? "Ready"
      
    @.on "msg", @sshObj.msg.send ? ( message ) =>
      console.log message
      
    @.on 'commandProcessing', @sshObj.onCommandProcessing ? ( command, response, sshObj, stream ) =>
      
    @.on 'commandComplete', @sshObj.onCommandComplete ? ( command, response, sshObj ) =>
      @.emit 'msg', "#{@sshObj.server.host}: this.onCommandComplete" if @sshObj.debug
      
    @.on 'commandTimeout',  @sshObj.onCommandTimeout ? ( command, response, stream, connection ) =>
      @.emit 'msg', "#{@sshObj.server.host}: this.onCommandTimeout" if @sshObj.debug
      @.emit 'msg', "#{@sshObj.server.host}:Timeout command: #{command} response: #{response}" if @sshObj.verbose
      @.emit "error", "#{@sshObj.server.host}: Command timed out after #{@.idleTime/1000} seconds", "Timeout", true, (err, type)=>
        @sshObj.sessionText += @_buffer

    @.on 'end', @sshObj.onEnd ? ( sessionText, sshObj ) =>
      @.emit 'msg', "#{@sshObj.server.host}: this.onEnd" if @sshObj.debug      
      
    @.on "close", (had_error) =>
      @.emit 'msg', "#{@sshObj.server.host}: this.onClose" if @sshObj.debug
      if had_error
        @.emit "error", had_error, "Close"
      else
        @.emit 'msg', @sshObj.closedMessage 
      
    @.on "error", @sshObj.onError ? (err, type, close = false, callback) =>
      @.emit 'msg', "#{@sshObj.server.host}: this.onError" if @sshObj.debug
      if ( err instanceof Error )
        @.emit 'msg', "Error: " + err.message + ", Level: " + err.level
      else
        @.emit 'msg', "#{type} error: " + err
      callback(err, type) if callback
      @connection.end() if close
        
    @.on "stderr", (data, type) =>
        @.emit 'msg', "stdError: " + type + ", data: " + data
        
  connect: ()=>
    if @sshObj.server and @sshObj.commands
      try
        @connection.on "keyboard-interactive", (name, instructions, instructionsLang, prompts, finish) =>
          @.emit 'msg', "#{@sshObj.server.host}: Connection.onKeyboardInteractive" if @sshObj.debug
          @.emit "keyboard-interactive", name, instructions, instructionsLang, prompts, finish
          
        @connection.on "connect", =>
          @.emit "connect"

        @connection.on "ready", =>
          @.emit "ready"

          #open a shell
          @connection.shell { pty: true }, (err, @_stream) =>
            if err then @.emit 'error', err, "Shell", true
            @.emit 'msg', "#{@sshObj.server.host}: Connection.shell" if @sshObj.debug
            @sshObj.sessionText = "Connected to #{@sshObj.server.host}#{@sshObj.enter}"
            
            @_stream.on "error", (err) =>
              @.emit 'msg', "#{@sshObj.server.host}: Stream.onError" if @sshObj.debug
              @.emit 'error', err, "Stream"

            @_stream.stderr.on 'data', (data) =>
              err = new Error("stderr data: #{data}")
              err.level = "stderr"
              @.emit 'msg', "#{@sshObj.server.host}: stderr.onData" if @sshObj.debug
              @.emit 'error', err, "Stream STDERR"
              
            @_stream.on "readable", =>
              try
                while (data = @_stream.read())
                  @_processData( "#{data}" )
              catch e
                err = new Error("#{e} #{e.stack}")
                err.level = "Data handling"
                @.emit 'error', err, "Data processing", true
                
            @_stream.on "finish", =>
              @.emit 'msg', "#{@sshObj.server.host}: Stream.onFinish" if @sshObj.debug
              @.emit 'end', @sshObj.sessionText, @sshObj
            
            @_stream.on "close", (code, signal) =>
              @.emit 'msg', "#{@sshObj.server.host}: Stream.onClose" if @sshObj.debug
              @connection.end()
          
        @connection.on "error", (err) =>
          @.emit 'msg', "#{@sshObj.server.host}: Connection.onError" if @sshObj.debug
          @.emit "error", err, "Connection", true
          
        @connection.on "close", (had_error) =>
          @.emit 'msg', "#{@sshObj.server.host}: Connection.onClose" if @sshObj.debug
          clearTimeout @sshObj.idleTimer if @sshObj.idleTimer
          @.emit "close", had_error

        @connection.connect
          host:             @sshObj.server.host
          port:             @sshObj.server.port
          forceIPv4:        @sshObj.server.forceIPv4
          forceIPv6:        @sshObj.server.forceIPv6
          hostHash:         @sshObj.server.hashMethod
          hostVerifier:     @sshObj.server.hostVerifier
          username:         @sshObj.server.userName
          password:         @sshObj.server.password
          agent:            @sshObj.server.agent
          agentForward:     @sshObj.server.agentForward
          privateKey:       @sshObj.server.privateKey
          passphrase:       @sshObj.server.passPhrase
          localHostname:    @sshObj.server.localHostname
          localUsername:    @sshObj.server.localUsername
          tryKeyboard:      @sshObj.server.tryKeyboard
          keepaliveInterval:@sshObj.server.keepaliveInterval
          keepaliveCountMax:@sshObj.server.keepaliveCountMax
          readyTimeout:     @sshObj.server.readyTimeout
          sock:             @sshObj.server.sock
          strictVendor:     @sshObj.server.strictVendor
          algorithms:       @sshObj.server.algorithms
          compress:         @sshObj.server.compress
          debug:            @sshObj.server.debug
      catch e
        @.emit 'error', "#{e} #{e.stack}", "Connect", true
        
    else
      @.emit 'error', "Missing connection parameters", "Parameters", false, missingParameters( err, type, close ) ->
        @.emit 'msg', @sshObj.server
        @.emit 'msg', @sshObj.commands

module.exports = SSH2Shell
