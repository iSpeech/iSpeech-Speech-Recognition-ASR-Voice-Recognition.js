# Speech Recognition - ASR

iSpeech's javascript speech recognition apis.

This class enables web based speech recognition using iSpeech's servers. It requires two files, iSpeechRecognizer.js and iSpeechWorker.js. To initialize iSpeechRecognizer use the code below:

```
audioRecognizer = new iSpeechRecognizer({
	apiKey: 'developerdemokeydeveloperdemokey',
	silenceDetection: true,
	workerLoc: 'iSpeechWorker.js'
});
```

where workerLoc is the location of the iSpeechWorker.js file. To start audio recognition call:
`audioRecognizer.start();`
Which will prompt the user to allow audio recording. **Note: if your site does not use https, the user will be prompted every time for permission to record.** The recognizer will continue to record until it is stopped, either with
`audioRecognizer.stop();`
or silence detection is enabled and silence is detected. For more information refer to the documentation in [doc/](doc/).

To request a valid apiKey contact [dev@ispeech.org](dev@ispeech.org)
