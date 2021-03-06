#! /usr/local/bin/node
/*jslint node:true */
// loader.js
// ------------------------------------------------------------------
//
// Load JSON collections into an API BaaS organization + app.
//
// created: Thu Feb  5 19:29:44 2015
// last saved: <2017-April-26 09:03:07>

var fs = require('fs'),
    path = require('path'),
    q = require('q'),
    Getopt = require('node-getopt'),
    common = require('./lib/common.js'),
    _ = require('lodash'),
    startTime,
    dataDir = path.join('./', 'data'),
    usergrid = require('usergrid'),
    re1 = new RegExp('\\s{2,}', 'g'),
    batchNum = 0,
    batchSize = 25,
    count = 0,
    getopt = new Getopt([
      ['c' , 'config=ARG', 'the configuration json file, which contains Usergrid/Baas org, app, and credentials'],
      ['o' , 'org=ARG', 'the Usergrid/BaaS organization.'],
      ['a' , 'app=ARG', 'the Usergrid/BaaS application.'],
      ['u' , 'username=ARG', 'app user with permissions to create collections. (only if not using client creds!)'],
      ['p' , 'password=ARG', 'password for the app user.'],
      ['i' , 'clientid=ARG', 'clientid for the Baas app. (only if not using user creds!)'],
      ['s' , 'clientsecret=ARG', 'clientsecret for the clientid.'],
      ['e' , 'endpoint=ARG', 'the BaaS endpoint (if not https://apibaas-trial.apigee.net)'],
      ['A' , 'anonymous', 'connect to BaaS anonymously. In lieu of user+pw or client id+secret.'],
      ['F' , 'file=ARG', 'upload just THIS .json file'],
      ['v' , 'verbose'],
      ['h' , 'help']
    ]).bindHelp();

// monkeypatch ug client to allow batch create.
// http://stackoverflow.com/a/24334895/48082
usergrid.client.prototype.batchCreate = function (type, entities, callback) {
  if (!entities.length) { callback(); }

  var data = _.map(entities, function(entity) {
    var data = (entity instanceof usergrid.entity) ? entity.get() : entity;
    return _.omit(data, 'metadata', 'created', 'modified', 'type', 'activated');
  });

  var options = {
    method: 'POST',
    endpoint: type,
    body: data
  };

  var self = this;
  this.request(options, function (e, data) {
    var entities = [];
    if (e) {
      if (self.logging) { common.logWrite('could not save entities'); }
      if (typeof(callback) === 'function') { callback(e, data); }
      return;
    }

    if (data && data.entities) {
      entities = _.map(data.entities, function(data) {
            var options = {
                  type: type,
                  client: self,
                  uuid: data.uuid,
                  data: data || {}
                };
            var entity = new usergrid.entity(options);
            entity._json = JSON.stringify(options.data, null, 2);
            return entity;
          });
    }
    else {
      e = "No data available";
    }
    if (typeof(callback) === 'function') {
      return callback(e, entities);
    }
  });
};


function postBatch(batch, ugClient, collection, cb) {
  var splitTime = new Date(),
      value = splitTime - startTime;
  batchNum++;
  common.logWrite('batch %d', batchNum);
  ugClient.batchCreate(collection, batch, function (e, entities) {
    cb(e, entities);
  });
}


function arrayToChunks(chunkSize, a) {
  var chunks = [];
  for (var i=0, L=a.length; i<L; i+=chunkSize) {
    chunks.push(a.slice(i,i+chunkSize));
  }
  return chunks;
}

var toBatches = _.curry(arrayToChunks)(batchSize);

function doUploadWork (ugClient, collectionName, data, cb) {
  toBatches(data)
    .reduce(function(promise, batch) {
      return promise.then(function() {
        var d = q.defer();
        postBatch(batch, ugClient, collectionName,
                  function(e, data) {
                    d.resolve({});
                  });
        return d.promise;
      });
    }, q({}))
    .then(function () {
      cb(null);
    }, function(e) {
      cb(e);
    });
}



  // data.forEach(function(item){
  //   count++;
  //   stack.push(item);
  //   // if (count % 100 === 0) {
  //   //   process.stdout.write('.');
  //   // }
  //   if (count % batchSize === 0) {
  //     //process.stdout.write('.');
  //   }
  //   if ((count != data.length) && (count % (100 * batchSize) === 0)) {
  //     var splitTime = new Date(),
  //         value = splitTime - startTime;
  //     common.logWrite(' %d elapsed %s', count, common.elapsedToHHMMSS(value));
  //   }
  // });
  //
  // if (stack.length > 0) {
  //   //process.stdout.write('.');
  //   postBatch(stack, ugClient, collectionName, function(e, data) {
  //     stack = [];
  //     cb(null);
  //   });
  // }


function main(args) {
  var collection, baasConn, opt = getopt.parse(args);
  try {
    baasConn = common.processOptions(opt, getopt);
    common.logWrite('start');
    startTime = new Date();
    common.usergridAuth(baasConn, function (e, ugClient){
      if (e) {
        common.logWrite(JSON.stringify(e, null, 2) + '\n');
        process.exit(1);
      }
      fs.readdir(dataDir, function (err,files){
        files.forEach(function(filename) {
          if (filename.endsWith('.json')) {
            if ( ! opt.options.file || opt.options.file == filename) {
              var shortname = filename.split('.json')[0];
              console.log('uploading ' + shortname);
              var data = JSON.parse(fs.readFileSync(path.join(dataDir, filename), 'utf8'));
              doUploadWork(ugClient, shortname, data, function(e) {
                var endTime = new Date(), value = endTime - startTime;
                common.logWrite('finis');
                common.logWrite('elapsed %d: %s', value, common.elapsedToHHMMSS(value));
              });
            }
          }
        });
      });
    });
  }
  catch (exc1) {
    console.log("Exception:" + exc1);
    console.log(exc1.stack);
  }
}

main(process.argv.slice(2));
