var DISPLAY_NAME = 'Picasa';
var albums = {};
var picasa = {
  albums: {},
  openedFiles: {}
};

// IDEAS FOR CONF
// - Show used space
// - Select thumbnail size
// - Select display name

// Helper function to get an authentication token.
function getAuthToken(successCallback) {
  chrome.identity.getAuthToken({ 'interactive': true }, function(token) {
    if (chrome.runtime.lastError) {
      console.log(chrome.runtime.lastError);
    } else {
      successCallback(token);
    }
  });
}

// Helper function to send an authorized request and receive a JSON response.
function request(url, successCallback, errorCallback) {
  getAuthToken(function(token) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.onloadend = function() {
      if (xhr.status === 200) {
        successCallback(xhr.response);
      } else if (xhr.status === 401) {
        // Removed cached token and try again.
        chrome.identity.removeCachedAuthToken({ token: token }, function() {
          request(url, successCallback, errorCallback);
        });
      } else if(xhr.status === 404) {
        errorCallback('NOT_FOUND');
      }
    };
    xhr.onerror = errorCallback;
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.responseType = 'json';
    xhr.send();
  });
}

// Get Picasa album list.
function getAlbumsList(successCallback, errorCallback) {
  var url = 'https://picasaweb.google.com/data/feed/api/user/default?alt=json' +
            '&fields=openSearch:totalResults,entry(gphoto:id,title,updated,gphoto:timestamp)' +
            '&hidestreamid=photos_from_posts' +
            '&max-results=50';
  request(url, successCallback, errorCallback);
}

// EXP
function getAlbums(successCallback, errorCallback) {
  var url = 'https://picasaweb.google.com/data/feed/api/user/default?alt=json-in-script&callback=fu' +
            '&fields=openSearch:totalResults,entry(gphoto:id,title,updated,gphoto:timestamp)' +
            '&hidestreamid=photos_from_posts' +
            '&max-results=50';
  request(url, function(jsonp) {
    f = new Function('fu', jsonp);
    
  }, errorCallback);
}

function fu() { console.error(arguments); }

// Get photos in Picasa album.
function getAlbumPhotos(albumId, successCallback, errorCallback) {
  var url = 'https://picasaweb.google.com/data/feed/api/user/default/albumid/' + albumId + '?alt=json' +
            '&fields=openSearch:totalResults,entry(gphoto:id,title,content,media:group/media:thumbnail,updated,gphoto:timestamp)' +
            '&thumbsize=160c' +
            '&imgmax=d' +
            '&max-results=50';
  request(url, successCallback, errorCallback);
}


function onGetMetadataRequested(options, onSuccess, onError) {
  console.info('Metadata requested: ', options);

  // Root dir request: return static root entry 
  if (options.entryPath === '/') {
    onSuccess({
      'isDirectory': true,
      'size': 0,
      'modificationTime': new Date()
    });
    return;
  }
  
  var path = options.entryPath.split('/').splice(1),
      album = path[0] || null,
      photo = path[1] || null;

  if(
      (album && !albums.hasOwnProperty(album)) ||
      (photo && (!albums[album].hasOwnProperty('files') || !albums[album].files.hasOwnProperty(photo)))
    ) {
    onError('NOT_FOUND');
    return;
  }
  
  var entry = photo ? albums[album].files[photo] : albums[album],
      entryMeta = {};
        
  if(options.name) entryMeta.name = options.entryPath.split('/').pop();
  //if(options.isDirectory) entryMeta.isDirectory = entry.isDirectory;
  if(options.isDirectory) entryMeta.isDirectory = !photo;
  if(options.modificationTime) entryMeta.modificationTime = entry.modificationTime;
  if(options.mimeType) entryMeta.mimeType = entry.mimeType;
  if(options.size && !photo) entryMeta.size = 0;
  if(options.size && entry.size) entryMeta.size = entry.size;
  if(options.thumbnail && entry.thumbnail) entryMeta.thumbnail = entry.thumbnail;
  else if(options.size && photo) {
    getFilesize(albums[album].files[photo].src, function(size) {
      albums[album].files[photo].size = size;
      entryMeta.size = size;
      onSuccess(entryMeta);
      return;
    }, onError);
  }
  else if(options.thumbnail && entry.thumbnailUrl) {
    getDataUri(entry.thumbnailUrl, function(dataUri) {
      albums[album].files[photo].thumbnail = dataUri;
      entryMeta.thumbnail = dataUri;
      onSuccess(entryMeta);
      return;
    }, onError);
  }
  else onSuccess(entryMeta);
  return;
}

function onReadDirectoryRequested(options, onSuccess, onError) {
  console.log('onReadDirectoryRequested', options);

  var album = options.directoryPath.substr(1);
  var entries = [];

  if(options.directoryPath == '/') {
  // Retrieve list of albums
    getAlbumsList(function(response) {
      if(response.feed && response.feed.entry) {
        for(var i = 0; i < response.feed.entry.length; i++) {
          var album = response.feed.entry[i].title.$t.replace(/\//g, '\u29f8');
          if(!albums.hasOwnProperty(album)) albums[album] = {};
          albums[album].id = response.feed.entry[i].gphoto$id.$t;
          albums[album].isDirectory = true;
          albums[album].modificationTime = new Date(response.feed.entry[i].updated.$t);
          
          entries.push({
            isDirectory: true,
            name: album
          });
        }
        
        onSuccess(entries, false);
        return;
      }
      else onError("FAILED");
    });
  }
  else if(album && albums[album]) {

    getAlbumPhotos(albums[album].id, function(response) {
      
      if(response.feed && response.feed.entry) {
        //albums[album].files = {};
        console.error('Page info: ', response.feed.openSearch$totalResults);
        
        for(var i = 0; i < response.feed.entry.length; i++) {
          
          if(!albums[album].hasOwnProperty('files')) {
            albums[album].files = {};
          }
          
          var name = response.feed.entry[i].title.$t.replace(/\//g, '\u29f8');
          if(albums[album].files.hasOwnProperty(name)) {
            name = name.replace(/(\.\w+$)/, ' Copy$1');
          }
          
          albums[album].files[name] = {
            id: response.feed.entry[i].gphoto$id.$t,
            src: response.feed.entry[i].content.src,
            isDirectory: false,
            mimeType: response.feed.entry[i].content.type,
            modificationTime: new Date(parseInt(response.feed.entry[i].gphoto$timestamp.$t, 10)),
            thumbnailUrl: response.feed.entry[i].media$group.media$thumbnail[0].url
          };
          entries.push({
            isDirectory: false,
            name: name,
          });
        }
        onSuccess(entries, false);
      }
      else onError("FAILED");
    }, onError);
    
  }
  
}


// TODO: Put error handling
function getDataUri(url, onSuccess, onError){
    var xhr = new XMLHttpRequest();
    xhr.responseType = 'blob';
    xhr.onload = function() {
        var reader  = new FileReader();
        reader.onerror = onError;
        reader.onloadend = function () {
          var dataUri = reader.result.replace(/^data:([\w-]+\/[\w-]+);/, 'data:image/jpeg;');
          onSuccess(dataUri);
        };
        reader.readAsDataURL(xhr.response);
    };
    xhr.open('GET', url);
    xhr.send();
}

// TODO: Put error handling
function getFilesize(url, onSuccess, onError) {
    var xhr = new XMLHttpRequest();
    xhr.open("HEAD", url, true);
    xhr.onerror = onError;
    xhr.onreadystatechange = function() {
      if (this.readyState == this.DONE) {
        onSuccess(parseInt(xhr.getResponseHeader("Content-Length", 10)));
      }
    };
    xhr.send();
}


// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

function onReadFileRequested(options, onSuccess, onError) {
  console.log('onReadFileRequested', options);

  var filePath = picasa.openedFiles[options.openRequestId].substr(1),
      album = filePath.split('/')[0],
      file = filePath.split('/')[1];
  
  // Check if file exists in storage
  if(!albums.hasOwnProperty(album) || !albums[album].hasOwnProperty('files') || !albums[album].files.hasOwnProperty(file)) {
    onError("NOT_FOUND");
    return;
  }
  
  var url = albums[album].files[file].src;
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url);
  xhr.responseType = 'arraybuffer';
  xhr.setRequestHeader('Range', 'bytes=' + options.offset + '-' + (options.length + options.offset - 1));
  xhr.onloadend = function() {
    if (xhr.status === 206) {
      onSuccess(xhr.response, false /* last call */);
    } else if (xhr.status === 416) {
      // There's nothing more...
      onSuccess(new ArrayBuffer(), false /* last call */);
    } else {
      onError('NOT_FOUND');
    }
  };
  xhr.send();
}

////////////////////////////////////////////////////////////////////////////////

function onOpenFileRequested(options, onSuccess, onError) {
  if (options.mode != 'READ' || options.create) {
    onError('INVALID_OPERATION');
  } else {
    picasa.openedFiles[options.requestId] = options.filePath;
    onSuccess();
  }
}

function onCloseFileRequested(options, onSuccess, onError) {
  if (!picasa.openedFiles[options.openRequestId]) {
    onError('INVALID_OPERATION');
    return;
  }
  delete picasa.openedFiles[options.openRequestId];
  onSuccess();
}

function onUnmountRequested(options, onSuccess, onError) {
  console.log('onUnmountRequested', options);
  chrome.fileSystemProvider.unmount({
    fileSystemId: options.fileSystemId
  }, function() {
  if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError);
      onError("FAILED");
    }
    else onSuccess();
  });
}

function onMountRequested(onSuccess, onError) {
  console.log('onMountRequested');
  chrome.fileSystemProvider.mount({
    fileSystemId: 'picasa',
    displayName: DISPLAY_NAME,
  }, function() {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError);
      onError("FAILED");
    }
    else onSuccess();
  });
}

chrome.fileSystemProvider.onGetMetadataRequested.addListener(onGetMetadataRequested);
chrome.fileSystemProvider.onReadDirectoryRequested.addListener(onReadDirectoryRequested);

chrome.fileSystemProvider.onOpenFileRequested.addListener(onOpenFileRequested);
chrome.fileSystemProvider.onReadFileRequested.addListener(onReadFileRequested);
chrome.fileSystemProvider.onCloseFileRequested.addListener(onCloseFileRequested);

chrome.fileSystemProvider.onUnmountRequested.addListener(onUnmountRequested);
chrome.fileSystemProvider.onMountRequested && chrome.fileSystemProvider.onMountRequested.addListener(onMountRequested);

