#================================
#  SSH2Shel
#================================
# Description
# SSH2 wrapper for creating a SSH shell connection and running multiple commands sequentially.
typeIsArray = Array.isArray || ( value ) -> return {}.toString.call( value ) is '[object Array]'
Stream = require('stream');

class SSH2Shell extends Stream
  sshObj:           {}
  command:          ""
  _hosts:            []
  _sshToNextHost:    false
  _primaryhostSessionText: ""
  _allSessions:      ""
  _connections:     []
  _stream:          {}
  _buffer:          ""
  idleTime:         5000
  asciiFilter:      ""
  textColorFilter:  ""
  passwordPrompt:    ""
  passphrasePrompt:  ""
  standardPrompt:    ""
  _callback:          =>
  onCommandProcessing:=>
  onCommandComplete:  =>
  onCommandTimeout:   =>
  onEnd:              =>  
  
  _onData: ( data )=>
    #add host response data to buffer

    @_buffer += data
    if @command.length > 0 and not @standardPrompt.test(@_sanitizeResponse())
      #continue loading the buffer and set/reset a timeout
      @.emit 'commandProcessing' , @command, @_buffer, @sshObj, @_stream
      clearTimeout @idleTimer if @idleTimer
      @idleTimer = setTimeout( =>
          @.emit 'commandTimeout', @.command, @._buffer, @._stream, @.connection
      , @idleTime)
    else if @command.length < 1 and not @standardPrompt.test(@_buffer)
      @.emit 'commandProcessing' , @command, @_buffer, @sshObj, @_stream

    #Set a timer to fire when no more data events are received
    #and then process the buffer based on command and prompt combinations
    clearTimeout @dataReceivedTimer if @dataReceivedTimer
    @dataReceivedTimer = setTimeout( =>
      #clear the command and SSH timeout timer
      clearTimeout @idleTimer if @idleTimer
      
      #remove test coloring from responses like [32m[31m
      unless @.sshObj.disableColorFilter
        @_buffer = @_buffer.replace(@textColorFilter, "")

      #remove non-standard ascii from terminal responses
      unless @.sshObj.disableASCIIFilter
        @_buffer = @_buffer.replace(@asciiFilter, "")

      switch (true)
        #check if sudo password is needed
        when @command.length > 0 and @command.indexOf("sudo ") isnt -1
          @emit 'msg', "#{@sshObj.server.host}: Sudo command data" if @sshObj.debug
          @_processPasswordPrompt()
        #check if ssh authentication needs to be handled
        when @sshObj.sshToNextHost and @command.length > 0 and @command.indexOf("ssh ") is 0
          @emit 'msg', "#{@sshObj.server.host}: SSH command data" if @sshObj.debug 
          @_processSSHPrompt()
        #check for standard prompt from a command
        when @command.length > 0 and @standardPrompt.test(@_sanitizeResponse())
          @emit 'msg', "#{@sshObj.server.host}: Normal prompt detected" if @sshObj.debug
          @sshObj.pwSent = false #reset sudo prompt checkable
          @_commandComplete()
        #check for no command but first prompt detected
        when @command.length < 1 and @standardPrompt.test(@_buffer)
          @emit 'msg', "#{@sshObj.server.host}: First prompt detected" if @sshObj.debug
          @sshObj.sessionText += @_buffer if @sshObj.showBanner
          @_nextCommand()
        else
          @emit 'msg', "Data processing: data received timeout" if @sshObj.debug
          @idleTimer = setTimeout( =>
              @.emit 'commandTimeout', @.command, @._buffer, @._stream, @.connection
          , @idleTime)
    , @dataIdleTime)

  _sanitizeResponse: =>
    return @_buffer.replace(@command.substr(0, @_buffer.length), "")

  _processPasswordPrompt: =>
    #First test for password prompt    
    response = @_sanitizeResponse().trim()
    passwordPrompt =  @passwordPrompt.test(response)
    standardPrompt = @standardPrompt.test(response)
    @.emit 'msg', "#{@sshObj.server.host}: Sudo Password prompt detected: #{passwordPrompt}" if @sshObj.debug
    @.emit 'msg', "#{@sshObj.server.host}: Sudo Password prompt: Password sent: #{@sshObj.pwSent}" if @sshObj.debug
    @.emit 'msg', "#{@sshObj.server.host}: Sudo Password: #{@sshObj.server.password}" if @sshObj.debug
    @.emit 'msg', "#{@sshObj.server.host}: Sudo Response: #{response}" if @sshObj.verbose
        
    #Prompt detection
    #no password
    switch (true)    
      when passwordPrompt and not @sshObj.server.password
        @.emit 'msg', "#{@sshObj.server.host}: Sudo password prompt no password set" if @sshObj.debug
        @_resetFromSudoError()
      when passwordPrompt and not @sshObj.pwSent
        @.emit 'msg', "#{@sshObj.server.host}: Sudo password prompt: Buffer: #{response}" if @sshObj.verbose
        @.emit 'msg', "#{@sshObj.server.host}: Sudo password prompt: Send password " if @sshObj.debug
        @.emit 'msg', "#{@sshObj.server.host}: Sudo sent password: #{@sshObj.server.password}" if @sshObj.verbose
        #send password
        @sshObj.pwSent = true
        @_runCommand("#{@sshObj.server.password}")
      when passwordPrompt and @sshObj.pwSent
        @.emit 'msg', "#{@sshObj.server.host}: Sudo password faied: response: #{response}" if @sshObj.verbose
        @.emit 'error', "#{@sshObj.server.host}: Sudo password was incorrect for #{@sshObj.server.userName}, Sudo authentication" if @sshObj.debug
        @.emit 'msg', "#{@sshObj.server.host}: Sudo failed password prompt: Password: [#{@sshObj.server.password}]" if @sshObj.debug
        @sshObj.pwSent = false
        #add buffer to sessionText so the sudo response can be seen
        @_resetFromSudoError()
      when standardPrompt
        @.emit 'msg', "#{@sshObj.server.host}: Sudo password accepted" if @sshObj.debug
        @sshObj.pwSent = false
        @.emit 'msg', "#{@sshObj.server.host}: Sudo Standard Response: #{response}" if @sshObj.verbose
        @_commandComplete()
      else
        @idleTimer = setTimeout( =>
              @.emit 'commandTimeout', @.command, response, @._stream, @._connection
          , @idleTime)

  _resetFromSudoError: =>
    @sshObj.pwSent = false
    @sshObj.sessionText += "#{@_buffer}"
    @_buffer = ""
    @command = ""
    #cancal command on host
    @_stream.write '\x03'

  _processSSHPrompt: =>
    #not authenticated yet so detect prompts
    response = @_sanitizeResponse().trim()
    clearTimeout @idleTimer if @idleTimer      
    passwordPrompt =  @passwordPrompt.test(response) and not @sshObj.server.hasOwnProperty("passPhrase")
    passphrasePrompt =  @passphrasePrompt.test(response) and @sshObj.server.hasOwnProperty("passPhrase")
    standardPrompt = @standardPrompt.test(response)

    @.emit 'msg', "#{@sshObj.server.host}: SSH: Password previously sent: #{@sshObj.sshAuth}" if @sshObj.verbose
        
    unless @sshObj.sshAuth
      @.emit 'msg', "#{@sshObj.server.host}: First SSH prompt detection" if @sshObj.debug
      
      #provide password
      if passwordPrompt
        @.emit 'msg', "#{@sshObj.server.host}: SSH send password" if @sshObj.debug
        @sshObj.sshAuth = true        
        @_buffer = ""
        
        @_runCommand("#{@sshObj.server.password}")
      #provide passphrase
      else if passphrasePrompt
        @.emit 'msg', "#{@sshObj.server.host}: SSH send passphrase" if @sshObj.debug
        @sshObj.sshAuth = true
        @_buffer = ""
        @_runCommand("#{@sshObj.server.passPhrase}")
      #normal prompt so continue with next command
      else if standardPrompt
        @.emit 'msg', "#{@sshObj.server.host}: SSH standard prompt: connection failed" if @sshObj.debug
        @.emit 'msg', "#{@sshObj.server.host}: SSH connection failed" 
        @.emit 'msg', "#{@sshObj.server.host}: SSH failed response: #{response}"
        @sshObj.sessionText += "#{@sshObj.server.host}: SSH failed: response: #{response}"
        @_runExit()
      else
        @.emit 'msg', "#{@sshObj.server.host}: SSH no prompt was not detected"
        @.emit 'msg', "#{@sshObj.server.host}: SSH response: #{response}" if @sshObj.verbose
        @.emit 'msg', "#{@sshObj.server.host}: SSH password prompt: #{@sshObj.passwordPrompt}" if @sshObj.verbose and not @sshObj.server.hasOwnProperty("password")        
        @.emit 'msg', "#{@sshObj.server.host}: SSH passphrase prompt: #{@sshObj.passphrasePrompt}" if @sshObj.verbose and @sshObj.server.hasOwnProperty("passPhrase")
        @.emit 'msg', "#{@sshObj.server.host}: SSH standard prompt: #{@sshObj.standardPrompt}" if @sshObj.verbose
        @_runExit()        
    else
      @.emit 'msg', "#{@sshObj.server.host}: SSH post authentication prompt detection" if @sshObj.debug
      #@sshObj.sshToNextHost = false
      
      if standardPrompt
        @.emit 'msg', "#{@sshObj.server.host}: SSH complete: normal prompt" if @sshObj.debug
        @sshObj.sessionText += "\n #{response}" if @sshObj.showBanner
        @sshObj.exitCommands.push "exit"
        @.emit 'msg', "#{@sshObj.connectedMessage}"
        @.emit 'msg', "#{@sshObj.readyMessage}"
        @.emit 'msg', "#{@sshObj.server.host}: SSH complete: next command" if @sshObj.debug
        @sshObj.sshToNextHost = false
        @_nextCommand()
      #Password or passphase detected a second time after authentication indicating failure.
      else if (passwordPrompt or passphrasePrompt)
        @.emit 'msg', "#{@sshObj.server.host}: SSH authentication failed"
        @.emit 'msg', "#{@sshObj.server.host}: SSH auth failed" if @sshObj.debug
        @.emit 'msg', "#{@sshObj.server.host}: SSH: failed response: #{response}" if @sshObj.verbose
        @sshObj.sshAuth = false
        using = switch
          when passwordPrompt then "SSH password: #{@sshObj.server.password}"
          when passphrasePrompt then "SSH passphrase: #{@sshObj.server.passPhrase}"
        @.emit 'error', "#{@sshObj.server.host}: SSH authentication failed for #{@sshObj.server.userName}@#{@sshObj.server.host}", "Nested host authentication"
        @.emit 'msg', "#{@sshObj.server.host}: SSH auth failed: Using " + using if @sshObj.debug
        
        #no connection so drop back to first host settings if there was one
        #@sshObj.sessionText += "#{@_buffer}"
        @.emit 'msg', "#{@sshObj.server.host}: SSH response: #{response}" if @sshObj.verbose
        if @_connections.length > 0
          return @_previousHost()
          
        @_runExit()

  _processNotifications: =>
    #check for notifications in commands
    if @command
      #this is a message for the sessionText like an echo command in bash
      if (sessionNote = @command.match(/^`(.*)`$/))
        @.emit 'msg', "#{@sshObj.server.host}: Notifications: sessionText output" if @sshObj.debug
        if @_connections.length > 0
          @sshObj.sessionText += "#{@sshObj.server.host}: Note: #{sessionNote[1]}#{@sshObj.enter}"
        else
          @sshObj.sessionText += "Note: #{sessionNote[1]}#{@sshObj.enter}"
        @.emit 'msg', sessionNote[1] if @sshObj.verbose
        @_nextCommand()
      #this is a message to output in process
      else if (msgNote = @command.match(/^msg:(.*)$/))
        @.emit 'msg', "#{@sshObj.server.host}: Notifications: msg to output" if @sshObj.debug
        @.emit 'msg', "#{@sshObj.server.host}: Note: #{msgNote[1]}"
        @_nextCommand()
      else
        @.emit 'msg', "#{@sshObj.server.host}: Notifications: Normal Command to run" if @sshObj.debug
        @_checkCommand()

  _commandComplete: =>
    response = @_buffer.trim()
    #check sudo su has been authenticated and add an extra exit command
    if @command isnt "" and @command isnt "exit" and @sshObj.sshToNextHost isnt true
      @.emit 'msg', "#{@sshObj.server.host}: Command complete:\nCommand:\n #{@command}\nResponse: #{response}" if @sshObj.verbose
      @sshObj.sessionText += response
      @.emit 'msg', "#{@sshObj.server.host}: Raising commandComplete event" if @sshObj.debug
      @.emit 'commandComplete', @command, @_buffer, @sshObj
    @_nextCommand()

  _nextCommand: =>
    @_buffer = ""
    #process the next command if there are any
    if @sshObj.commands.length > 0
      @.emit 'msg', "#{@sshObj.server.host}: Host.commands: #{@sshObj.commands}" if @sshObj.verbose
      @command = @sshObj.commands.shift()
      @.emit 'msg', "#{@sshObj.server.host}: Next command from host.commands: #{@command}" if @sshObj.verbose
      @_processNotifications()
    else
      @.emit 'msg', "#{@sshObj.server.host}: No commands so exit" if @sshObj.debug
      #no more commands so exit
      @_runExit()

  _checkCommand: =>
    #if there is still a command to run then run it or exit
    if @command != ""
      @_runCommand(@command)
    else
      #no more commands so exit
      @.emit 'msg', "#{@sshObj.server.host}: No command so exit" if @sshObj.debug
      @_runExit()

  _runCommand: (command) =>
    @.emit 'msg', "#{@sshObj.server.host}: sending: #{command}" if @sshObj.verbose
    @.emit 'msg', "#{@sshObj.server.host}: run command" if @sshObj.debug
    @_stream.write "#{command}#{@sshObj.enter}"

  _previousHost: =>
    @.emit 'msg', "#{@sshObj.server.host}: Load previous host config" if @sshObj.debug
    @.emit 'end', "#{@sshObj.server.host}: \n#{@sshObj.sessionText}", @sshObj
    @.emit 'msg', "#{@sshObj.server.host}: Previous hosts: #{@_connections.length}" if @sshObj.debug
    
    if @_connections.length > 0
      @sshObj = @_connections.pop()
      @.emit 'msg', "#{@sshObj.server.host}: Reload previous host" if @sshObj.debug
      #@_loadDefaults(@_runExit)
      @_runExit()
    else
      @_runExit()
      

  _nextHost: =>
    nextHost = @sshObj.hosts.shift()
    @.emit 'msg', "#{@sshObj.server.host}: SSH to #{nextHost.server.host}" if @sshObj.debug
    @.emit 'msg', "#{@sshObj.server.host}: Clearing previous event handlers" if @sshObj.debug
    @.emit 'msg', "#{@sshObj.server.host}: Remove previous event handlers" if @sshObj.debug
    @_removeListeners()
      
    @_connections.push(@sshObj) 
   
    @sshObj = nextHost
    
    @_initiate(@_sshConnect)
    
    
  _nextPrimaryHost: ( connect )=>
    if @_hosts.length > 0
      #check this is not loading the first primary host before removing listeners
      if @sshObj.server
        @.emit 'msg', "#{@sshObj.server.host}: Current primary host" if @sshObj.debug
        @.emit 'msg', "#{@sshObj.server.host}: Remove previous event handlers" if @sshObj.debug
        @.emit 'end', @_primaryhostSessionText, @sshObj
        @_removeListeners()
      @sshObj = @_hosts.shift()
      @_primaryhostSessionText = "#{@sshObj.server.host}: "
      
      @.emit 'msg', "#{@sshObj.server.host}: Next primary host" if @sshObj.debug
      
      @_initiate(connect)
    else
      @.emit 'msg', "#{@sshObj.server.host}: No more primary hosts" if @sshObj.debug
      @_runExit
      
    
  _sshConnect: =>
    
    #add ssh commandline options from host.server.ssh
    sshFlags   = "-x"
    sshOptions = ""
    if @sshObj.server.ssh
      sshFlags   += @sshObj.server.ssh.forceProtocolVersion if @sshObj.server.ssh.forceProtocolVersion
      sshFlags   += @sshObj.server.ssh.forceAddressType if @sshObj.server.ssh.forceAddressType
      sshFlags   += "T" if @sshObj.server.ssh.disablePseudoTTY
      sshFlags   += "t" if @sshObj.server.ssh.forcePseudoTTY
      sshFlags   += "v" if @sshObj.server.ssh.verbose

      sshOptions += " -c " + @sshObj.server.ssh.cipherSpec if @sshObj.server.ssh.cipherSpec
      sshOptions += " -e " + @sshObj.server.ssh.escape if @sshObj.server.ssh.escape
      sshOptions += " -E " + @sshObj.server.ssh.logFile if @sshObj.server.ssh.logFile
      sshOptions += " -F " + @sshObj.server.ssh.configFile if @sshObj.server.ssh.configFile
      sshOptions += " -i " + @sshObj.server.ssh.identityFile if @sshObj.server.ssh.identityFile
      sshOptions += " -l " + @sshObj.server.ssh.loginName if @sshObj.server.ssh.loginName
      sshOptions += " -m " + @sshObj.server.ssh.macSpec if @sshObj.server.ssh.macSpec
      sshOptions += ' -o "#{option}={#value}"' for option,value of @sshObj.server.ssh.Options
    sshOptions += ' -o "StrictHostKeyChecking=no"'
    sshOptions += " -p #{@sshObj.server.port}"
    @sshObj.sshAuth = false
    @sshObj.sshToNextHost = true
    @command = "ssh #{sshFlags} #{sshOptions} #{@sshObj.server.userName}@#{@sshObj.server.host}"
    @.emit 'msg', "#{@sshObj.server.host}: SSH command: connect" if @sshObj.debug
    @_runCommand(@command)

  _runExit: =>
    @.emit 'msg', "#{@sshObj.server.host}: Process an exit" if @sshObj.debug
    #run the exit commands loaded by ssh and sudo su commands
    if @sshObj.exitCommands and @sshObj.exitCommands.length > 0
      @.emit 'msg', "#{@sshObj.server.host}: Queued exit commands: #{@sshObj.exitCommands.length}" if @sshObj.debug
      @command = @sshObj.exitCommands.pop()
      if @_connections and @_connections.length > 0
        @.emit 'msg', "#{@sshObj.server.host}: Primary host: #{@_connections[0].server.host}" if @sshObj.verbose
        @_connections[0].sessionText += "\n#{@sshObj.server.host}: #{@sshObj.sessionText}"
      @_runCommand(@command)
    #more hosts to connect to so process the next one
    else if @sshObj.hosts and @sshObj.hosts.length > 0
      @.emit 'msg', "#{@sshObj.server.host}: Next host from this host" if @sshObj.debug
      @_nextHost()
    #Leaving last host so load previous host
    else if @_connections and @_connections.length > 0
      @.emit 'msg', "#{@sshObj.server.host}: load previous host" if @sshObj.debug
      @.emit 'msg', "#{@sshObj.server.host}: #{@sshObj.closedMessage}"
      @_previousHost()
    else if @command is "exit"
      @.emit 'msg', "#{@sshObj.server.host}: Manual exit command" if @sshObj.debug
      @_runCommand("exit")
      #Nothing more to do so end the stream with last exit
    else
      @close()
      
  close: =>
    @.emit 'msg', "#{@sshObj.server.host}: Exit command: Stream: close" if @sshObj.debug
    @_stream.close() #"exit#{@sshObj.enter}"

  _removeListeners: =>
    ###
    if @sshObj.debug
      @.emit 'msg', "#{@sshObj.server.host}: Event handler count:"
      @.emit 'msg', "keyboard-interactive: " + (@.listenerCount 'keyboard-interactive')
      @.emit 'msg', "error: " + (@.listenerCount "error")
      @.emit 'msg', "data: " + (@.listenerCount "data")
      @.emit 'msg', "stderrData: " + (@.listenerCount "stderrData")
      @.emit 'msg', "end: " + (@.listenerCount 'end')
      @.emit 'msg', "commandProcessing: " + (@.listenerCount 'commandProcessing')
      @.emit 'msg', "commandComplete: " + (@.listenerCount 'commandComplete')
      @.emit 'msg', "commandTimeout: " + (@.listenerCount 'commandTimeout')
      @.emit 'msg', "msg: " + (@.listenerCount 'msg')    
    ###
    #changed to removing host defined listeners instead of all listeners
    @.removeListener "keyboard-interactive", @sshObj.onKeyboardInteractive if typeof @sshObj.onKeyboardInteractive == 'function'
    @.removeListener "stderrData", @sshObj.onStderrData if typeof @sshObj.onStderrData == 'function'
    @.removeListener "data", @sshObj.onData if typeof @sshObj.onData == 'function'
    @.removeListener "error", @sshObj.onError if typeof @sshObj.onError == 'function'
    @.removeListener "stderrData", @sshObj.onStderrData if typeof @sshObj.onStderrData == 'function'
    @.removeListener "end", @sshObj.onEnd if typeof @sshObj.onEnd == 'function'
    @.removeListener "commandProcessing", @sshObj.onCommandProcessing if typeof @sshObj.onCommandProcessing == 'function'
    @.removeListener "commandComplete", @sshObj.onCommandComplete if typeof @sshObj.onCommandComplete == 'function'
    @.removeListener "commandTimeout", @sshObj.onCommandTimeout if typeof @sshObj.onCommandTimeout == 'function'
    @.removeListener "msg", @sshObj.msg  if typeof @sshObj.msg == 'function'
  
    clearTimeout @idleTimer if @idleTimer
    clearTimeout @dataReceivedTimer if @dataReceivedTimer
    
  constructor: (hosts) ->
    super hosts
    if typeIsArray(hosts) and hosts.length > 0
      @_hosts = hosts
    else
      @_hosts = [hosts]
    
    @ssh2Client = require('ssh2').Client
    
    #defined here to support msg events before the host is loaded
    @.on "msg", ( message ) =>
        console.log message
        
    @.on "newPrimmaryHost", @_nextPrimaryHost
    
    @.on "data", (data) =>
      @_onData( data )
      
    @.on "stderrData", (data) =>
      console.error data
     
    @.on "error", (err, type, close = false, callback) =>
      @.emit 'msg', "Class.error: #{err}, #{type}" if @sshObj.debug
      if ( err instanceof Error )
        @.emit 'msg', "Error: " + err.message + ", Level: " + err.level
      else
        @.emit 'msg', "#{type} error: " + err
      
      @_stream.close() if close
      
    if @_hosts[0].server.tryKeyboard 
      @.on "keyboard-interactive", ( name, instructions, instructionsLang, prompts, finish ) =>
        @.emit 'msg', "#{@sshObj.server.host}: Class.keyboard-interactive" if @sshObj.debug
        if @sshObj.verbose
          @.emit 'msg', "name: " + name
          @.emit 'msg', "instructions: " + instructions
          str = JSON.stringify(prompts, null, 4)
          @.emit 'msg', "Prompts object: " + str
          
    @_allSessions = ""
    
    
  _initiate: (action)=>
    @.emit 'msg', "#{@sshObj.server.host}: initiate" if @sshObj.debug
        
    @_loadDefaults()
    #event handlers
          
    if typeof action == 'function'
      action()
      
  _loadDefaults: () =>
    
    #old hubot leftovers
    if @sshObj.msg and @sshObj.msg.send and typeof @sshObj.msg.send == 'function'
      @sshObj.msg = @sshObj.msg.send
    
    if @.listenerCount("msg") > 0
      @.removeAllListeners "msg"
    
    if typeof @sshObj.msg == 'function'
      @.on "msg", @sshObj.msg
    else
      @.on "msg", ( message ) =>
        console.log message
        
    @.emit 'msg', "#{@sshObj.server.host}: Load Defaults" if @sshObj.debug
    @command = ""
    @_buffer = ""
    @sshObj.sshToNextHost = false
    @sshObj.connectedMessage  = "Connected" unless @sshObj.connectedMessage
    @sshObj.readyMessage      = "Ready" unless @sshObj.readyMessage
    @sshObj.closedMessage     = "Closed" unless @sshObj.closedMessage
    @sshObj.showBanner        = false unless @sshObj.showBanner
    @sshObj.verbose           = false unless @sshObj.verbose
    @sshObj.debug             = false unless @sshObj.debug
    @sshObj.hosts             = [] unless @sshObj.hosts
    @sshObj.commands          = [] unless @sshObj.commands
    @sshObj.standardPrompt    = ">$%#" unless @sshObj.standardPrompt
    @sshObj.passwordPrompt    = @sshObj.passwordPromt unless @sshObj.passwordPrompt
    @sshObj.passphrasePrompt  = @sshObj.passphrasePromt unless @sshObj.passphrasePrompt
    @sshObj.passwordPrompt    = ":" unless @sshObj.passwordPrompt
    @sshObj.passphrasePrompt  = ":" unless @sshObj.passphrasePrompt
    @sshObj.passPromptText    = "Password" unless @sshObj.passPromptText
    @sshObj.enter             = "\n" unless @sshObj.enter #windows = "\r\n", Linux = "\n", Mac = "\r"
    @sshObj.asciiFilter       = "[^\r\n\x20-\x7e]" unless @sshObj.asciiFilter
    @sshObj.disableColorFilter = false unless @sshObj.disableColorFilter is true
    @sshObj.disableASCIIFilter = false unless @sshObj.disableASCIIFilter is true
    @sshObj.textColorFilter   = "(\[{1}[0-9;]+m{1})" unless @sshObj.textColorFilter
    @sshObj.exitCommands      = [] unless @sshObj.exitCommands
    @sshObj.pwSent            = false
    @sshObj.sshAuth           = false
    @sshObj.server.hashKey    = @sshObj.server.hashKey ? ""
    @sshObj.sessionText       = "" unless @sshObj.sessionText
    @sshObj.streamEncoding    = @sshObj.streamEncoding ? "utf8"
    @sshObj.window            = true unless @sshObj.window
    @sshObj.pty               = true unless @sshObj.pty
    @idleTime                 = @sshObj.idleTimeOut ? 5000
    @dataIdleTime             = @sshObj.dataIdleTime ? 500
    @asciiFilter              = new RegExp(@sshObj.asciiFilter,"g") unless @asciiFilter
    @textColorFilter          = new RegExp(@sshObj.textColorFilter,"g") unless @textColorFilter
    @passwordPrompt            = new RegExp(@sshObj.passPromptText+".*" + @sshObj.passwordPrompt + "\\s?$","i") unless @passwordPrompt
    @passphrasePrompt          = new RegExp(@sshObj.passPromptText+".*" + @sshObj.passphrasePrompt + "\\s?$","i") unless @passphrasePrompt
    @standardPrompt           = new RegExp("[" + @sshObj.standardPrompt + "]\\s?$") unless @standardPrompt
    

    @sshObj.onCommandProcessing  = @sshObj.onCommandProcessing ? ( command, response, sshObj, stream ) =>

    @sshObj.onCommandComplete = @sshObj.onCommandComplete ? ( command, response, sshObj ) =>
      @.emit 'msg', "#{@sshObj.server.host}: Class.commandComplete" if @sshObj.debug

    @sshObj.onCommandTimeout  = @sshObj.onCommandTimeout ? ( command, response, stream, connection ) =>
      response = response.replace(@command, "")
      @.emit 'msg', "#{@sshObj.server.host}: Class.commandTimeout" if @sshObj.debug
      @.emit 'msg', "#{@sshObj.server.host}: Timeout command: #{command} response: #{response}" if @sshObj.verbose
      
      @.emit "error", "#{@sshObj.server.host}: Command timed out after #{@.idleTime/1000} seconds", "Timeout", true, (err, type)=>
      @sshObj.sessionText += @_buffer
      
    @.on "keyboard-interactive",  @sshObj.onKeyboardInteractive if typeof @sshObj.onKeyboardInteractive == 'function'  
    @.on "error", @sshObj.onError if typeof @sshObj.onError == 'function'
    @.on "data", @sshObj.onData if typeof @sshObj.onData == 'function'
    @.on "stderrData", @sshObj.onStderrData if typeof @sshObj.onStderrData == 'function'
    @.on "commandProcessing", @sshObj.onCommandProcessing
    @.on "commandComplete", @sshObj.onCommandComplete
    @.on "commandTimeout", @sshObj.onCommandTimeout
    @.on "end", @sshObj.onEnd if typeof @sshObj.onEnd == 'function'
    
    @.emit 'msg', "#{@sshObj.server.host}: Host loaded" if @sshObj.debug
    @.emit 'msg', @sshObj if @sshObj.verbose
    
    
    
  connect: (callback)=>
    @_callback = callback if typeof callback == 'function'
    
    @.emit "newPrimaryHost", @_nextPrimaryHost(@_connect)

  _connect: =>
    
    @connection = new @ssh2Client()

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
      @connection.shell @sshObj.window, { pty: @sshObj.pty }, (err, @_stream) =>
        if err instanceof Error
           @.emit 'error', err, "Shell", true
           return
        @.emit 'msg', "#{@sshObj.server.host}: Connection.shell" if @sshObj.debug
        @_stream.setEncoding(@sshObj.streamEncoding);

        @_stream.on "error", (err) =>
          @.emit 'msg', "#{@sshObj.server.host}: Stream.error" if @sshObj.debug
          @.emit 'error', err, "Stream"

        @_stream.stderr.on 'data', (data) =>
          @.emit 'msg', "#{@sshObj.server.host}: Stream.stderr.data" if @sshObj.debug
          @.emit 'stderrData', data

        @_stream.on "data", (data)=>
          try
            @.emit 'data', data                
          catch e
            err = new Error("#{e} #{e.stack}")
            err.level = "Data handling"
            @.emit 'error', err, "Stream.read", true

        @_stream.on "finish", =>
          @.emit 'msg', "#{@sshObj.server.host}: Stream.finish" if @sshObj.debug
          
          @_primaryhostSessionText += @sshObj.sessionText+"\n"
          @_allSessions += @_primaryhostSessionText
          if @_hosts.length == 0
            @.emit 'end', @_allSessions, @sshObj
          
        @_stream.on "close", (code, signal) =>
          @.emit 'msg', "#{@sshObj.server.host}: Stream.close" if @sshObj.debug
          @connection.end()

    @connection.on "error", (err) =>
      @.emit 'msg', "#{@sshObj.server.host}: Connection.error" if @sshObj.debug
      @.emit "error", err, "Connection"


    @connection.on "close", (had_error) =>
      @.emit 'msg', "#{@sshObj.server.host}: Connection.close" if @sshObj.debug
      clearTimeout @idleTimer if @idleTimer
      clearTimeout @dataReceivedTimer if @dataReceivedTimer
      if had_error
        @.emit "error", had_error, "Connection close"
      else
        @.emit 'msg', @sshObj.closedMessage
      
      if @_hosts.length == 0
        if typeof @_callback == 'function'
          @_callback @_allSessions
          @_removeListeners()
          return @_allSessions
      else        
        @.emit "newPrimaryHost", @_nextPrimaryHost(@_connect)
            

    if @sshObj.server and @sshObj.commands
      try
        @sshObj.server.username = @sshObj.server.userName unless @sshObj.server.username
        @sshObj.server.hostHash = @sshObj.server.hashMethod unless @sshObj.server.hostHash
        @sshObj.server.passphrase = @sshObj.server.passPhrase unless @sshObj.server.passphrase
        @connection.connect @sshObj.server
      catch e
        @.emit 'error', "#{e} #{e.stack}", "Connection.connect", true
    else
      @.emit 'error', "Missing connection parameters", "Parameters", false, ( err, type, close ) ->
        @.emit 'msg', @sshObj.server
        @.emit 'msg', @sshObj.commands
    return @_stream


module.exports = SSH2Shell
