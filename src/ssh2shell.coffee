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
      @.emit 'msg', "#{@sshObj.server.host}: Normal prompt detected" if @sshObj.debug
      @sshObj.pwSent = false #reset sudo prompt checkable
      @_processNextCommand()
    #command still processing
    else
      @.emit 'commandProcessing' , @command, @_buffer, @sshObj, @_stream 
      clearTimeout @sshObj.idleTimer if @sshObj.idleTimer
      @sshObj.idleTimer = setTimeout( =>
        @.emit 'commandTimeout', @.command, @._buffer, @._stream, @._connection
      , @idleTime)

  _processPasswordPrompt: =>
    #First test for password prompt
    @.emit 'msg', "#{@sshObj.server.host}: Password prompt: Sent flag #{@sshObj.pwSent}" if @sshObj.verbose
    unless @sshObj.pwSent      
      #when the buffer is fully loaded the prompt can be detected
      @.emit 'msg', "#{@sshObj.server.host}: Password prompt: Buffer: #{@_buffer}" if @sshObj.verbose
      if @passwordPromt.test(@_buffer)
        @.emit 'msg', "#{@sshObj.server.host}: Password prompt: Send password " if @sshObj.debug
        @.emit 'msg', "#{@sshObj.server.host}: Sent password: #{@sshObj.server.password}" if @sshObj.verbose
        
        @sshObj.pwSent = true
        @_stream.write "#{@sshObj.server.password}#{@sshObj.enter}"        
      #normal prompt so continue with next command
      else if @standardPromt.test(@_buffer)
        @.emit 'msg', "#{@sshObj.server.host}: Password prompt: Standard prompt after password sent" if @sshObj.debug
        @_processNextCommand()
        
    #normal prompt so continue with next command
    else if @standardPromt.test(@_buffer)
      @.emit 'msg', "#{@sshObj.server.host}: Password prompt: Standard prompt detected" if @sshObj.debug
      @_processNextCommand()
      
    #password sent so either check for failure or run next command  
    else
      #reprompted for password again so failed password 
      if @passwordPromt.test(@_buffer) 
        @.emit 'msg', "#{@sshObj.server.host}: Sudo password faied: Buffer: #{@_buffer}" if @sshObj.verbose
        @.emit 'error', "Sudo password was incorrect for #{@sshObj.server.userName}, leaving host.", "Sudo authentication"
        @.emit 'msg', "#{@sshObj.server.host}: Failed password prompt: Password: [#{@sshObj.server.password}]" if @sshObj.debug
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
        @.emit 'msg', "#{@sshObj.server.host}: SSH password prompt" if @sshObj.debug
        @sshObj.sshAuth = true
        @_stream.write "#{@sshObj.server.password}#{@sshObj.enter}"
      #provide passphrase
      else if @passphrasePromt.test(@_buffer)
        @.emit 'msg', "#{@sshObj.server.host}: SSH passphrase prompt" if @sshObj.debug
        @sshObj.sshAuth = "true"
        @_stream.write "#{@sshObj.server.passPhrase}#{@sshObj.enter}"
      #normal prompt so continue with next command
      else if @standardPromt.test(@_buffer)
        @.emit 'msg', "#{@sshObj.server.host}: SSH auth normal prompt" if @sshObj.debug
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
      else if @standardPromt.test(@_buffer)
        @.emit 'msg', "#{@sshObj.server.host}: SSH normal prompt" if @sshObj.debug
        @sshObj.sessionText += "Connected to #{@sshObj.server.host}#{@sshObj.enter}"
        @_processNextCommand()
        
  _processNotifications: =>
    #check for notifications in commands
    while @command and ((sessionNote = @command.match(/^`(.*)`$/)) or (msgNote = @command.match(/^msg:(.*)$/)))
      #this is a message for the sessionText like an echo command in bash
      if sessionNote
        @sshObj.sessionText += "#{@sshObj.server.host}: Note: #{sessionNote[1]}#{@sshObj.enter}"
        @.emit 'msg', sessionNote[1] if @sshObj.verbose

      #this is a message to output in process
      else if msgNote
        @.emit 'msg', "#{@sshObj.server.host}: Note: #{msgNote[1]}"
      
      #load the next command and repeat the checks
      if @sshObj.commands.length > 0
        @command = @sshObj.commands.shift()
      else
        @_runExit()

  _processNextCommand: =>
    #check sudo su has been authenticated and add an extra exit command
    if @command.indexOf("sudo su") isnt -1
      @sshObj.exitCommands.push "exit" 
      
    if @command isnt "" and @command isnt "exit" and @command.indexOf("ssh ") is -1
      #Not running an exit command or first prompt detection after connection
      #load the full buffer into sessionText and raise a commandComplete event
      #remove non-standard ascii from terminal responses
      @_buffer = @_buffer.replace(@asciiFilter, "")
      #remove test coloring from responses like [32m[31m
      unless @sshObj.disableColorFilter
        @_buffer = @_buffer.replace(@textColorFilter, "")
      @sshObj.sessionText += @_buffer
    
    @.emit 'commandComplete', @command, @_buffer, @sshObj
      
    @.emit 'msg', "#{@sshObj.server.host}: Command complete: Response: #{@_buffer}" if @sshObj.verbose 
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
    @.emit 'msg', "#{@sshObj.server.host}: Next command: #{@command}" if @sshObj.debug
    @_stream.write "#{@command}#{@sshObj.enter}"
    
  _nextHost: =>
    @_buffer = ""
    @nextHost = @sshObj.hosts.shift()
    @.emit 'msg', "#{@sshObj.server.host}: SSH to #{@nextHost.server.host}" if @sshObj.debug  
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
      @.emit 'msg', "#{@sshObj.server.host}: Queued hosts for this host" if @sshObj.debug
      @.emit 'msg', @sshObj.hosts if @sshObj.debug
      @_nextHost()
    #Leaving last host so load previous host 
    else if @_connections and @_connections.length > 0
      host = @sshObj.server.host
      @.emit 'end', @sshObj.sessionText, @sshObj
      clearTimeout @sshObj.idleTimer if @sshObj.idleTimer
      @sshObj = @_connections.pop()
      @.emit 'msg', "#{@sshObj.enter}Previous host object:" if @sshObj.debug
      @.emit 'msg', @sshObj if @sshObj.debug
      @.emit 'msg', "#{@sshObj.server.host}: Reload previous host object" if @sshObj.debug
      if @_connections.length > 0
        @.emit 'msg', "#{@sshObj.server.host}: Pushed exit command to disconnect SSH session for #{host}" if @sshObj.debug
        @sshObj.exitCommands.push "exit"
      @_processNextCommand()
    #Nothing more to do so end the stream with last exit
    else
      @.emit 'msg', "#{@sshObj.server.host}: Exit command: Stream: close" if @sshObj.debug
      #@.command = "stream.end()"
      @_stream.close() #"exit#{@sshObj.enter}"
      
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
    @sshObj.textColorFilter   = "(\[{1}[0-9;]+m{1})" unless @sshObj.textColorFilter
    @sshObj.exitCommands      = []
    @sshObj.pwSent            = false
    @sshObj.sshAuth           = false
    @sshObj.server.hashKey    = @sshObj.server.hashKey ? ""
    @sshObj.sessionText       = ""
    @idleTime                 = @sshObj.idleTimeOut ? 5000
    @asciiFilter              = new RegExp(@sshObj.asciiFilter,"g")
    @textColorFilter          = new RegExp(@sshObj.textColorFilter,"g")
    @passwordPromt            = new RegExp("password.*" + @sshObj.passwordPromt + "\\s?$","i")
    @passphrasePromt          = new RegExp("password.*" + @sshObj.passphrasePromt + "\\s?$","i")
    @standardPromt            = new RegExp("[" + @sshObj.standardPrompt + "]\\s?$")
    
    #event handlers    
    @.on "keyboard-interactive", ( name, instructions, instructionsLang, prompts, finish ) =>
      @.emit 'msg', "#{@sshObj.server.host}: Class.keyboard-interactive" if @sshObj.debug
      @.emit 'msg', "#{@sshObj.server.host}: Keyboard-interactive: finish([response, array]) not called in class event handler." if @sshObj.debug
      if @sshObj.verbose
        @.emit 'msg', "name: " + name
        @.emit 'msg', "instructions: " + instructions
        str = JSON.stringify(prompts, null, 4)
        @.emit 'msg', "Prompts object: " + str
      @sshObj.onKeyboardInteractive name, instructions, instructionsLang, prompts, finish if @sshObj.onKeyboardInteractive
      
    @.on "msg", @sshObj.msg.send ? ( message ) =>
      console.log message
      
    @.on 'commandProcessing', @sshObj.onCommandProcessing ? ( command, response, sshObj, stream ) =>
      
    @.on 'commandComplete', @sshObj.onCommandComplete ? ( command, response, sshObj ) =>
      @.emit 'msg', "#{@sshObj.server.host}: Class.commandComplete" if @sshObj.debug
      
    @.on 'commandTimeout',  @sshObj.onCommandTimeout ? ( command, response, stream, connection ) =>
      @.emit 'msg', "#{@sshObj.server.host}: Class.commandTimeout" if @sshObj.debug
      @.emit 'msg', "#{@sshObj.server.host}: Timeout command: #{command} response: #{response}" if @sshObj.verbose
      @.emit "error", "#{@sshObj.server.host}: Command timed out after #{@.idleTime/1000} seconds", "Timeout", true, (err, type)=>
        @sshObj.sessionText += @_buffer

    @.on 'end', @sshObj.onEnd ? ( sessionText, sshObj ) =>
      @.emit 'msg', "#{@sshObj.server.host}: Class.end" if @sshObj.debug   
    
  constructor: (@sshObj) ->
    @_loadDefaults()
    
    @connection = new require('ssh2')()    
      
    @.on "error", @sshObj.onError ? (err, type, close = false, callback) =>
      @.emit 'msg', "#{@sshObj.server.host}: Class.error" if @sshObj.debug
      if ( err instanceof Error )
        @.emit 'msg', "Error: " + err.message + ", Level: " + err.level
      else
        @.emit 'msg', "#{type} error: " + err
      callback(err, type) if callback
      @connection.end() if close
        
  connect: ()=>
    if @sshObj.server and @sshObj.commands
      try
        @connection.on "keyboard-interactive", (name, instructions, instructionsLang, prompts, finish) =>
          @.emit 'msg', "#{@sshObj.server.host}: Connection.keyboard-interactive" if @sshObj.debug
          @.emit "keyboard-interactive", name, instructions, instructionsLang, prompts, finish
          
        @connection.on "connect", =>
          @.emit 'msg', "#{@sshObj.server.host}: Connection.connect" if @sshObj.debug
          @.emit 'msg', @sshObj.connectedMessage

        @connection.on "ready", =>
          @.emit 'msg', "#{@sshObj.server.host}: Connection.ready" if @sshObj.debug
          @.emit 'msg', @sshObj.readyMessage

          #open a shell
          @connection.shell { pty: true }, (err, @_stream) =>
            if err then @.emit 'error', err, "Shell", true
            @.emit 'msg', "#{@sshObj.server.host}: Connection.shell" if @sshObj.debug
            @sshObj.sessionText = "Connected to #{@sshObj.server.host}#{@sshObj.enter}"
            
            @_stream.on "error", (err) =>
              @.emit 'msg', "#{@sshObj.server.host}: Stream.error" if @sshObj.debug
              @.emit 'error', err, "Stream"

            @_stream.stderr.on 'data', (data) =>
              err = new Error("stderr data: #{data}")
              err.level = "stderr"
              @.emit 'msg', "#{@sshObj.server.host}: Stream.stderr.data" if @sshObj.debug
              @.emit 'error', err, "Stream STDERR"
              
            @_stream.on "readable", =>
              try
                while (data = @_stream.read())
                  @_processData( "#{data}" )
              catch e
                err = new Error("#{e} #{e.stack}")
                err.level = "Data handling"
                @.emit 'error', err, "Stream.read", true
                
            @_stream.on "finish", =>
              @.emit 'msg', "#{@sshObj.server.host}: Stream.finish" if @sshObj.debug
              @.emit 'end', @sshObj.sessionText, @sshObj
              
            @_stream.on "close", (code, signal) =>                          
              @.emit 'msg', "#{@sshObj.server.host}: Stream.close" if @sshObj.debug
              @connection.end()
          
        @connection.on "error", (err) =>
          @.emit 'msg', "#{@sshObj.server.host}: Connection.error" if @sshObj.debug
          @.emit "error", err, "Connection"
          
        @connection.on "close", (had_error) =>
          @.emit 'msg', "#{@sshObj.server.host}: Connection.close" if @sshObj.debug
          clearTimeout @sshObj.idleTimer if @sshObj.idleTimer
          if had_error
            @.emit "error", had_error, "Connection close"
          else
            @.emit 'msg', @sshObj.closedMessage

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
        @.emit 'error', "#{e} #{e.stack}", "Connection.connect", true        
    else
      @.emit 'error', "Missing connection parameters", "Parameters", false, missingParameters( err, type, close ) ->
        @.emit 'msg', @sshObj.server
        @.emit 'msg', @sshObj.commands

module.exports = SSH2Shell
