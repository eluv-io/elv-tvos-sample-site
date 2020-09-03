var express = require('express');
var exbars = require('exbars');
var moment = require('moment')
var Fabric = require('./server/fabric');
var {Site, AllTitles} = require('./server/site');
var Config = require('./config.json');
var path = require('path');
var atob = require('atob');
var {JQ,isEmpty,CreateID} = require('./server/utils')
var fs = require('fs');
var logger = require('./server/logger');
var Mutex = require('async-mutex').Mutex;
var Semaphore = require('async-mutex').Semaphore;
const { ElvClient } = require('@eluvio/elv-client-js/src/ElvClient');
const morgan = require('morgan');
var rfs = require('rotating-file-stream');
var LRU = require("lru-cache")
const { performance } = require('perf_hooks');

const MAX_CACHED_ITEMS = Config.maxCacheItems || 2000;
const MAX_REQUESTS = Config.maxRequests || 500;
const CACHE_EXPIRE_DURATION_MS = Config.cacheExpiration || 1000*60*60*2;

const requestsLock = new Semaphore(MAX_REQUESTS);
const clientCacheMutex = new Mutex();
const cacheOptions = { max: MAX_CACHED_ITEMS, maxAge: CACHE_EXPIRE_DURATION_MS }
const clientCache = new LRU(cacheOptions);

var app = express();

var networkSites = {};
var date = "";

var backendClients = {};

const logMem = () => {
  logger.info("Memory Usage: " + JQ(process.memoryUsage()));
}

const init = async (network) => {
  let f0 = performance.now();
  logger.info("Init start. Setting backend client for network: " + network);
  try{
    let configUrl = Config.networks[network].configUrl;
    let backendClient = await ElvClient.FromConfigurationUrl({
      configUrl
    });
    const wallet = backendClient.GenerateWallet();
    const signer = wallet.AddAccountFromMnemonic({mnemonic:wallet.GenerateMnemonic()});
    backendClient.SetSigner({signer});
    backendClients[network] = backendClient;
    logMem();
    let f1 = performance.now();
    logger.info(`Init finished. ${f1 - f0} ms`);
  }catch(e){
    logger.error("Error intializing backend client. " + JQ(e));
  }
}

const redeemCode2 = async (network,code, force=false) => {
  const t0 = performance.now();
  logger.info("Redeem start. " + network + " force: " + force);
  
  let configUrl = Config.networks[network].configUrl;
  let staticToken = Config.networks[network].staticToken;
  let siteSelectorId = Config.networks[network].siteSelectorId;
  let backendClient = backendClients[network];

  if(isEmpty(backendClient)){
    logger.error("RedeemCode: backendClient not found for network: " + network);
    return null;
  }

  if(isEmpty(configUrl)){
    logger.error("RedeemCode: configUrl not set in config.");
    return null;
  }

  if(isEmpty(siteSelectorId)){
    logger.error("siteSelectorId not set in config.");
    return null;
  }

  let site = null;
  let siteId = null;
  let fabric = null;
  let isError = false;
  let cache = null;
  let redeemMutex = null;
  let client = null;

  try{
    client = await ElvClient.FromConfigurationUrl({
      configUrl,
      staticToken
    });
    client.SetSigner({signer:backendClient.signer});
  }catch(e){
    logger.error("Error initiating client. " + JQ(e));
    return null;
  }

  try{
    clientCacheMutex.acquire();
    cache = clientCache.get(code);
    clientCacheMutex.release();

    if(cache && cache["fabric"] && cache["siteId"]){
      fabric = cache["fabric"];
      siteId = cache["siteId"];
      redeemMutex = cache["redeemMutex"];
      logger.info("Found in cache.");
    }
  }catch(e){
    logger.error("Error getting mutex. " + JQ(e));
    return null;
  }

  if(!redeemMutex){
    redeemMutex = new Mutex();
  }
  redeemMutex.acquire();

  try{
    if(force || !fabric || !siteId){

      //Get the issuer
      let prefix = code.substr(0,3);
      let accessCode = code.substr(3);

      logger.info(`ElvClient LatestVersionHash start. objectId ${siteSelectorId}`);
      f0 = performance.now();

      let siteSelectorHash = await backendClient.LatestVersionHash({objectId: siteSelectorId});
      f1 = performance.now();
      logger.info(`ElvClient LatestVersionHash finished.  Result: ${siteSelectorHash}\n${f1 - f0} ms`);

      logger.info(`ElvClient ContentObjectMetadata. versionHash ${siteSelectorHash}`);
      f0 = performance.now();
      let meta = await backendClient.ContentObjectMetadata({
        versionHash: siteSelectorHash,
        metadataSubtree: "public/sites"
      });
      f1 = performance.now();
      logger.info(`ElvClient ContentObjectMetadata finished. ${f1 - f0} ms`);

      let issuer = meta[prefix].issuer;

      logger.info(`ElvClient RedeemCode. Prefix: ${prefix}, Issuer: ${issuer}`);
      f0 = performance.now();
      siteId = await client.RedeemCode({
        issuer,
        code: accessCode
      });
      f1 = performance.now();
      logger.info(`ElvClient RedeemCode finished. Result: ${siteId}\n${f1 - f0} ms`);

      fabric = new Fabric;
      await fabric.initFromClient({client});
    }

    logger.info("Get Site / Titles Info start.");
    f0 = performance.now();
    let newSite = new Site({fabric, siteId});
    await newSite.loadSite();
    f1 = performance.now();
    logger.info(`Get Site / Titles Info finished. ${f1 - f0} ms`);

    clientCacheMutex.acquire();
    clientCache.set(code,{siteId, fabric, network, redeemMutex});
    logger.info("Added to cache. Cache length: " + clientCache.length);
    logMem();
    clientCacheMutex.release();
    site = newSite;
  }catch(e){
    logger.error("Error redeeming code and getting site information: " + JQ(e));
    isError = true;
  }finally{
    clientCacheMutex.release();
    redeemMutex.release();
  }

  if(isError){
    clientCacheMutex.acquire();
    clientCache.del(code);
    logger.info("Removed from cache. Cache length: " + clientCache.length);
    clientCacheMutex.release();
    logMem();
  }
  const t1 = performance.now();
  logger.info(`Redeem finished. ${t1 - t0} ms.`);
  return site;
}

const main = async () => {
  logger.info("Using config: " + JQ(Config));

  let serverHost = Config.serverHost;
  let serverPort = Config.serverPort || 4001;
  let updateInterval = Config.updateInterval || 60000;

  for(let network in Config.networks){
    await init(network);
  }

  app.engine('hbs', exbars({defaultLayout: false}));
  app.set('view engine', 'hbs');
  app.set('views', path.join(__dirname, '/views'));

  // create a rotating write stream
  var accessLogStream = rfs.createStream('requests.log', {
    interval: '1d', // rotate daily
    path: path.join(__dirname, 'logs')
  })

  app.use(morgan('combined', { stream: accessLogStream }));

  app.get('/settings.hbs', function(req, res) {
    requestsLock
    .acquire()
    .then(function([value, release]) {
      //Keep the templates for the device to inject
      const params = {
        fabric_node:"{{fabric_node}}",
        session_id:"{{session_id}}",
        app_id:"{{app_id}}",
        app_version:"{{app_version}}",
        system_version:"{{system_version}}",
        system_lang:"{{system_lang}}"
      };
      res.set('Cache-Control', 'no-cache');
      res.render("settings", params);
      release();
    });

  });

  app.get('/index.hbs/:network', function(req, res) {
    requestsLock
    .acquire()
    .then(function([value, release]) {

      let network = req.params.network;
      if(!network){
        network = "main";
      }
      const params = {
        eluvio_logo: serverHost + "/logo.png",
        eluvio_background: serverHost + "/eluvio_background.png",
        network,
        date
      };
      res.set('Cache-Control', 'no-cache');
      res.render("index", params);
      release();
    });
  });

  app.get('/redeem.hbs', function(req, res) {
    requestsLock
    .acquire()
    .then(function([value, release]) {
      const params = {
        eluvio_background: serverHost + "/eluvio_background_darker.png"
      };
      res.set('Cache-Control', 'no-cache');
      res.render("redeem", params);
      release();
    });
  });

  //Serve the site tvml template
  app.get(['/redeemsite.hbs/:network/:code', '/redeemwatch.hbs/:network/:code'], async function(req, res) {
    const [value, release] = await requestsLock.acquire();

    try {
      let view = req.path.split('.').slice(0, -1).join('.').substr(1);
      let code = req.params.code;
      let network = req.params.network;

      if(!network){
        throw "No network for request";
      }

      let site = null;

      site = await redeemCode2(network, code);
      if(!site){
        throw "Could not get Site from code: " + code;
      }
      site.network = network;

      let titles = site.siteInfo.titles || [];
      let playlists = site.siteInfo.playlists || [];
      let synopsis = site.siteInfo.info ? site.siteInfo.info.synopsis : "";
      let titleColor = "rgb(236,245,255)";

      let site_info = {
        display_title: site.siteInfo.display_title,
        title_logo: site.siteInfo.title_logo,
        landscape_logo: site.siteInfo.landscape_logo,
        info: {
          synopsis: synopsis
        }
      }

      const params = {
        title_logo: site.siteInfo.title_logo,
        main_background: site.siteInfo.main_background,
        title_color: titleColor,
        display_title: site.siteInfo.display_title,
        playlists: playlists,
        titles: titles,
        eluvio_logo: serverHost + "/logo.png",
        code,
        site_id: site.siteId,
        site_info: JSON.stringify(site_info),
        date,
        network
      };

      res.set('Cache-Control', 'max-age=300');
      res.render(view, params);
    }catch(e){
      res.send(JQ(e), 404);
    }finally {
      release();
    }
  });


  //Serve the title details from versionHash tvml template
  app.get('/details.hbs/:network/:code/:id', async function(req, res) {
    const [value, release] = await requestsLock.acquire();

    try {
      let view = req.path.split('.').slice(0, -1).join('.').substr(1);
      let code = req.params.code;
      let id = req.params.id;
      let network = req.params.network;
      let site = await redeemCode2(network,code,false);
      let title = site.getTitle({id});
      if(!title){
        throw "title does not exist: " + id;
      }

      let director = "";
      let genre = "";
      let date = "";
      let cast = [];
      let exec_producers = [];
      let producers = [];
      let length = "";
      let tvRating = "";
      let copyright = "";
      let offerings = {};

      try {
        if(!title.availableOfferings){
          await title.getAvailableOfferings();
        }
        offerings = title.availableOfferings || {};
      }catch(e){

      }

      try {
        let directorObj = title.info.talent.director[0];
        director = directorObj.talent_first_name + " " + directorObj.talent_last_name;
      }catch(e){}
      try {
        genre = title.info.genre[0];
      }catch(e){}
      try {
        date = title.info.release_date;
      }catch(e){}
      try {
        cast = title.info.talent.cast || [];
      }catch(e){}
      try {
        producers = title.info.talent.producer || [];
      }catch(e){}
      try {
        exec_producers = title.info.talent.executive_producer || [];
      }catch(e){}
      try {
        length = title.info.runtime || "";
      }catch(e){}

      try {
        tvRating = title.info.tv_rating || "";
      }catch(e){}

      try {
        copyright = title.info.copyright || "";
      }catch(e){}

      let numOfferings = Object.keys(offerings).length;

      let posterUrl = title.posterUrl;

      const params = {
        code,
        titleId:id,
        director,
        genre,
        date,
        cast,
        producers,
        exec_producers,
        title,
        tvRating,
        length,
        offerings,
        numOfferings,
        posterUrl,
        date,
        main_background: site.siteInfo.main_background,
        play_icon: serverHost + "/play.png"
      };
      res.set('Cache-Control', 'no-cache');
      res.render(view, params);
    }catch(e){
      logger.error("Error getting details for title. " + JQ(e));
      res.send("Could not find title.", 404);
    }finally {
      release();
    }
  });

  //Serve the networks tvml template
  app.get('/networks.hbs/:network', async function(req, res) {
    const [value, release] = await requestsLock.acquire();
    try {
      let networks = Object.keys(Config.networks);
      let network = req.params.network;
      const params = {
        eluvio_logo: serverHost + "/logo.png",
        eluvio_background: serverHost + "/eluvio_background.png",
        networks,
        network
      };

      res.set('Cache-Control', 'no-cache');
      res.render('networks', params);
    }catch(e){

      var template = '<document><loadingTemplate><activityIndicator><text>Server Busy. Restart application.</text></activityIndicator></loadingTemplate></document>';
      res.send(template, 404);
    }finally {
      release();
    }
  });

  //Serve the sites tvml template
  app.get('/sites.hbs/:network', async function(req, res) {
    const [value, release] = await requestsLock.acquire();
    try {
      let network = req.params.network;
      logger.info("Route /sites.hbs/" + network);

      let sites = networkSites[network];

      if(!sites || sites.length == 0){
        sites = await findSites(Config.networks[network]);
        networkSites[network] = sites;
      }

      const params = {
        sites,
        eluvio_logo: serverHost + "/logo.png",
        eluvio_background: serverHost + "/eluvio_background.png",
        network: "{{network}}",
        date
      };
      res.set('Cache-Control', 'no-cache');
      res.render("sites", params);
    }catch(e){

        var template = '<document><loadingTemplate><activityIndicator><text>Could not load sites view.</text></activityIndicator></loadingTemplate></document>';
        res.send(template, 404);
    }finally {
      release();
    }
  });

  //Serve the version information
  app.get('/info', async function(req, res) {
    const [value, release] = await requestsLock.acquire();
    try{
      fs.readFile('./package.json', 'utf8', function (err,info) {
        if (err) {
          logger.error("Error reading package file." + JQ(err));
          res.send(err, 404);
          return err;
        }
        let json = JSON.parse(info);
        res.send(json.version);
      });
    }catch(err){
      logger.error("Could not read package.json "+ JQ(err));
      res.send(err, 404);
    }finally {
      release();
    }
  });

  //Serve playoutUrl
  app.get('/title/videoUrl/:network/:code/:id/:offeringId', async function(req, res) {
    const [value, release] = await requestsLock.acquire();
    try{
      let code = req.params.code;
      let id = req.params.id;
      let offeringId = req.params.offeringId;
      let network = req.params.network;

      let site = await redeemCode2(network,code,false);
      let title = site.getTitle({id});

      if(!title){
        throw "title does not exist: " + id;
      }

      let info = {
        videoUrl: await title.getVideoUrl(offeringId)
      };
      res.send(info);
    }catch(err){
      logger.error("Could not get title url: " + JQ(err));
      res.send(err, 404);
    }finally {
      release();
    }
  });

  const appFunc = async function(req, res) {
    const [value, release] = await requestsLock.acquire();
    try{
      let sessionTag = CreateID(8);
      const params = {
        CONFIG: JSON.stringify(Config),
        UPDATE_INTERVAL: updateInterval,
        SESSION_TAG: sessionTag
      };
      res.type('text');
      res.render('application', params);
    }catch(err){
      logger.error("Error serving application.js "+ JQ(err));
      res.send(err, 500);
    }finally {
      release();
    }
  };

  //Serve the application.js template
  app.get('/application.js', appFunc);
  //Fix for older app with malformed urls.
  app.get('//application.js', appFunc);
  
  app.use(express.static('static'));
  app.use(express.static('views'));

  // catch 404 and forward to error handler
  app.use(function (req, res, next) {
    const err = new Error('Not Found');
    err.status = 404;
    next(err);
  });

  logger.info("Server running on port: " + serverPort);
  app.listen(serverPort);
}


main();

exports.app = app;