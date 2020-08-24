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
var Sugar = require('sugar');
var app = express();

var networkSites = {};
var siteStore = {};
var date = "";

const Hash = (code) => {
  const chars = code.split("").map(code => code.charCodeAt(0));
  return chars.reduce((sum, char, i) => (chars[i + 1] ? (sum * 2) + char * chars[i+1] * (i + 1) : sum + char), 0).toString();
};

const refreshSites = async () =>{
  for (const network in Config.networks) {
    let value = Config.networks[network];
    // console.log(`${network}: ${JQ(value)}`);
    findSites(value).then(
      (sites)=>{
        networkSites[network] = sites;
      },
      (err)=>{
        logger.error("Error finding sites for network " + network + ".\n" + err);
      }
    )
  }

}

const findSites = async (network) =>{
  let configUrl = network.configUrl;
  let privateKey = process.env.PRIVATEKEY;
  if(isEmpty(configUrl)){
    let error = "configUrl not set for network.";
    logger.error(error);
    throw error;
  }

  if(isEmpty(privateKey)){
    let error = "Please 'export PRIVATEKEY=XXXX' before running.";
    logger.error(error);
    throw error;
  }
  
  let fabric = new Fabric;
  try{
    await fabric.init({configUrl,privateKey});
    var sitesIds = await fabric.findSites();
    let newSites = [];
    await Promise.all(
      sitesIds.map(async siteId => {
          let newSite = new Site({fabric, siteId});
          await newSite.loadSite();
          newSites.push(newSite);
          siteStore[siteId] = newSite;
      })
    );
    date = moment().format('MM/DD/YYYY h:mm:ss a');
    return newSites;
  }catch(e){
    console.error(e);
    return [];
  }
}

const getTitle = ({siteId,id}) =>{
  let site = siteStore[siteId];
  return site.titleStore[id];
}

const redeemCode = async (network,code) => {
  // console.log("RedeemCode " + JQ(network));
  let configUrl = network.configUrl;
  let privateKey = process.env.PRIVATEKEY;
  let siteSelectorId = network.siteSelectorId;

  if(isEmpty(configUrl)){
    logger.error("RedeemCode: configUrl not set in config.");
    return null;
  }

  if(isEmpty(privateKey)){
    logger.error("RedeemCode: No privateKey set.");
    return null;
  }

  if(isEmpty(siteSelectorId)){
    logger.error("siteSelectorId not set in config.");
    return null;
  }

  let fabric = new Fabric;
  let encryptedPrivateKey = "";
  let siteId = "";
  try{
    const hash = Hash(code);
    await fabric.init({configUrl,privateKey});
    let client = fabric.client;
    let siteSelector = await client.LatestVersionHash({objectId: siteSelectorId});
    const isGlobalSelector = (await client.ContentObjectMetadata({
      versionHash: siteSelector,
      metadataSubtree: "public/site_selector_type"
    })) === "global";

    let codeInfo;
    if(isGlobalSelector) {
      // Get unresolved meta to determine length of selector list
      const selectorList = await client.ContentObjectMetadata({
        versionHash: siteSelector,
        metadataSubtree: "public/site_selectors"
      });

      for(let i = 0; i < selectorList.length; i++) {
        codeInfo = await client.ContentObjectMetadata({
          versionHash: siteSelector,
          metadataSubtree: `public/site_selectors/${i}/${hash}`
        });

        if(codeInfo && codeInfo.ak) {
          break;
        }
      }
    } else {
      codeInfo = await client.ContentObjectMetadata({
        versionHash: siteSelector,
        metadataSubtree: `public/codes/${hash}`
      });
    }

    if(!codeInfo || !codeInfo.ak) {
      return false;
    }

    //console.log("CodeInfo: " + JQ(codeInfo));

    siteId = codeInfo.sites[0].siteId; 
    encryptedPrivateKey = atob(codeInfo.ak);

  }catch(e){
    console.error("Error reading site selector:");
    console.error(e);
    return null;
  }

  try {
    await fabric.initFromEncrypted({configUrl, encryptedPrivateKey, password: code});
    let newSite = new Site({fabric, siteId});
    await newSite.loadSite();
    siteStore[siteId] = newSite;
    return newSite;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error redeeming code:");
    // eslint-disable-next-line no-console
    console.error(error);
    return null;
  }
}

const main = async () => {
  let serverHost = Config.serverHost;
  let serverPort = Config.serverPort || 4001;
  let updateInterval = Config.updateInterval || 60000;
  let privateKey = process.env.PRIVATEKEY;

  if(isEmpty(privateKey)){
    let error = "Please 'export PRIVATEKEY=XXXX' before running.";
    logger.error(error);
    console.error(error);
    process.exit(1);
  }
  
  app.engine('hbs', exbars({defaultLayout: false}));
  app.set('view engine', 'hbs');
  app.set('views', path.join(__dirname, '/views'));

  refreshSites();
  //Refresh the Site every updateInterval
  setInterval(()=>{refreshSites()}, updateInterval);

  app.get('/settings.hbs', async function(req, res) {
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
  });

  app.get('/index.hbs/:network', async function(req, res) {
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
  });

  app.get('/redeem.hbs', async function(req, res) {
    const params = {
      eluvio_background: serverHost + "/eluvio_background_darker.png"
    };
    res.set('Cache-Control', 'no-cache');
    res.render("redeem", params);
  });

  //Serve the site tvml template
  app.get(['/redeemsite.hbs/:network/:code', '/redeemwatch.hbs/:network/:code'], async function(req, res) {
    try {
      let view = req.path.split('.').slice(0, -1).join('.').substr(1);
      let code = req.params.code;
      let network = req.params.network;

      // console.log("Route "+ view + "/" + network + "/" + code);
      if(!network){
        throw "No network for request";
      }

      let site = null;
      
      site = await redeemCode(Config.networks[network],code);
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
        site_index: code,
        site_id: site.siteId,
        site_info: JSON.stringify(site_info),
        date,
        network
      };

      res.set('Cache-Control', 'max-age=300');
      res.render(view, params);
    }catch(e){
      console.error(e);
      var template = '<document><loadingTemplate><activityIndicator><text>Could not load site from code.</text></activityIndicator></loadingTemplate></document>';
      res.send(template, 404);
    }
  });


  //Serve the site tvml template
  app.get(['/site.hbs/:network/:index','/watch.hbs/:network/:index'], async function(req, res) {
    try {
      let view = req.path.split('.').slice(0, -1).join('.').substr(1);
      let index = req.params.index;
      let network = req.params.network;
      console.log("Route "+ view + "/" + network + "/" + index);
      let sites = networkSites[network];
      let site = sites[index];
      let titles = site.siteInfo.titles || [];
      let playlists = site.siteInfo.playlists || [];
      let titleColor = "rgb(236,245,255)";
      const params = {
        title_logo: site.siteInfo.title_logo,
        main_background: site.siteInfo.main_background,
        title_color: titleColor,
        display_title: site.display_title,
        playlists: playlists,
        titles: titles,
        eluvio_logo: serverHost + "/logo.png",
        site_index: index,
        site_id: site.siteId,
        network,
        date
      };

      res.set('Cache-Control', 'no-cache');
      res.render(view, params);
    }catch(e){
      console.error(e);
      var template = '<document><loadingTemplate><activityIndicator><text>Error Fetching Site.</text></activityIndicator></loadingTemplate></document>';
      res.send(template, 404);
    }
  });

  //Serve the title details from versionHash tvml template
  app.get('/details.hbs/:siteId/:id', async function(req, res) {
    try {
      let view = req.path.split('.').slice(0, -1).join('.').substr(1);
      let siteId = req.params.siteId;
      let id = req.params.id;
      console.log("Route "+ view + "/" + siteId + "/" + id);

      let title = getTitle({siteId,id});
      console.log("Title found: " + title.display_title);
      let site = siteStore[siteId];

      let director = "";
      let genre = "";
      let date = "";
      let cast = [];
      let length = "";
      let offerings = {};
      try {
        if(!title.availableOfferings){
          await title.getAvailableOfferings();
        }
        offerings = title.availableOfferings || {};
      }catch(e){
        console.error(e);
      }
      try {
        director = title.info.talent.director[0].talent_full_name;
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

      let numOfferings = Object.keys(offerings).length;

      let posterUrl = title.posterUrl;

      const params = {
        siteId,
        titleId:id,
        director,
        genre,
        date,
        cast,
        title,
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
      logger.error(e);
      var template = '<document><loadingTemplate><activityIndicator><text>Server Busy. Restart application.</text></activityIndicator></loadingTemplate></document>';
      res.send(template, 404);
    }
  });

  //Serve the networks tvml template
  app.get('/networks.hbs/:network', async function(req, res) {
    try {
      let networks = Object.keys(Config.networks);
      let network = req.params.network;
      console.log("Route /networks.hbs/" + network);

      const params = {
        eluvio_logo: serverHost + "/logo.png",
        eluvio_background: serverHost + "/eluvio_background.png",
        networks,
        network
      };

      res.set('Cache-Control', 'no-cache');
      res.render('networks', params);
    }catch(e){
      console.error(e);
      var template = '<document><loadingTemplate><activityIndicator><text>Server Busy. Restart application.</text></activityIndicator></loadingTemplate></document>';
      res.send(template, 404);
    }
  });

  //Serve the sites tvml template
  app.get('/sites.hbs/:network', async function(req, res) {
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
        console.error(e);
        var template = '<document><loadingTemplate><activityIndicator><text>Could not load sites view.</text></activityIndicator></loadingTemplate></document>';
        res.send(template, 404);
      }
  });

  //Serve the version information
  app.get('/info', async function(req, res) {
    try{
      fs.readFile('./version.txt', 'utf8', function (err,info) {
        if (err) {
          logger.error(JQ(err));
          res.send(err, 404);
          return err;
        }
        res.send(info);
      });
    }catch(err){
      logger.error("Could not read version.txt "+err);
      res.send(err, 404);
    }
  });

  //Serve the logs information
  app.get('/log', async function(req, res) {
    try{
      let formatted = Sugar.Date.format(new Date(), '%Y-%m-%d');
      let logfile = `./static/logs/elv-tvos-${formatted}.log`;
      fs.readFile(logfile, 'utf8', function (err,info) {
        if (err) {
          logger.error("Could not read file " + logfile + "\n" +err);
          res.send(err, 404);
          return err;
        }
        res.send(info);
      });
    }catch(err){
      logger.error("Could not read log file: " +err);
      res.send(err, 404);
    }
  });

    //Serve playoutUrl
    app.get('/title/videoUrl/:siteId/:id/:offeringId', async function(req, res) {
      try{
        let siteId = req.params.siteId;
        let id = req.params.id;
        let offeringId = req.params.offeringId;
        let title = getTitle({siteId,id});
        if(!title){
          throw "title does not exist: " + id;
        }
        console.log("title video found: " + JQ(title));
        let info = {
          videoUrl: await title.getVideoUrl(offeringId)
        };
        res.send(info);
      }catch(err){
        logger.error("Could not get title url: " +err);
        res.send(err, 404);
      }
    });

  const appFunc = async function(req, res) {
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
      logger.error("Error serving application.js "+err);
      res.send(err, 500);
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