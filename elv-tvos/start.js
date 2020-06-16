var express = require('express');
var exbars = require('exbars');
var moment = require('moment')
var Fabric = require('./server/fabric');
var {Site, AllTitles} = require('./server/site');
var Config = require('./config.json');
var path = require('path');
var atob = require('atob');
var {JQ,isEmpty,CreateID} = require('./server/utils')

var app = express();

var sites = [];
var redeemSites = {};
var date = "";

const Hash = (code) => {
  const chars = code.split("").map(code => code.charCodeAt(0));
  return chars.reduce((sum, char, i) => (chars[i + 1] ? (sum * 2) + char * chars[i+1] * (i + 1) : sum + char), 0).toString();
};


const refreshSites = async (config) =>{
  let configUrl = config.configUrl;
  let privateKey = process.env.PRIVATEKEY;
  if(isEmpty(configUrl)){
    console.error("configUrl not set in config.");
    process.exit(1);
  }

  if(isEmpty(privateKey)){
    console.error("Please 'export PRIVATEKEY=XXXX' before running.");
    process.exit(1);
  }
  
  let fabric = new Fabric;
  try{
    await fabric.init({configUrl,privateKey});
    var sitesIds = await fabric.findSites();
    let newSites = [];
    await Promise.all(
      sitesIds.map(async siteId => {
          // console.log("Loading site: " + siteId);
          let newSite = new Site({fabric, siteId});
          await newSite.loadSite();
          // console.log("Site loaded: " + JQ(newSite.siteInfo));
          newSites.push(newSite.siteInfo);
      })
    );
    // console.log("Sites: " + JQ(sites));
    date = moment().format('MM/DD/YYYY h:mm:ss a');
    sites = newSites;
  }catch(e){
    console.error(e);
  }
}

const redeemCode = async (config,code) => {
  let configUrl = config.configUrl;
  let privateKey = process.env.PRIVATEKEY;
  let siteSelectorId = config.siteSelectorId;

  if(isEmpty(configUrl)){
    console.error("configUrl not set in config.");
    return null;
  }

  if(isEmpty(privateKey)){
    console.error("Please 'export PRIVATEKEY=XXXX' before running.");
    return null;
  }

  if(isEmpty(siteSelectorId)){
    console.error("siteSelectorId not set in config.");
    return null;
  }

  let fabric = new Fabric;
  let encryptedPrivateKey = "";
  let siteId = "";
  try{
    const hash = Hash(code);
    await fabric.init({configUrl,privateKey});
    let siteSelector = await fabric.client.LatestVersionHash({objectId: siteSelectorId});

    const siteInfo = await fabric.client.ContentObjectMetadata({
      versionHash: siteSelector,
      metadataSubtree: `public/codes/${hash}`
    });

    if(!siteInfo) {
      this.SetError("Invalid code");
      return null;;
    }
    siteId = siteInfo.sites[0].siteId; 
    encryptedPrivateKey = atob(siteInfo.ak);

  }catch(e){
    console.error("Error reading site selector:");
    console.error(e);
    return null;
  }

  try {
    await fabric.initFromEncrypted({configUrl, encryptedPrivateKey, password: code});
    let newSite = new Site({fabric, siteId});
    await newSite.loadSite();
    return newSite.siteInfo;
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

  app.engine('hbs', exbars({defaultLayout: false}));
  app.set('view engine', 'hbs');
  app.set('views', path.join(__dirname, '/views'));

  await refreshSites(Config);
  //Refresh the Site every updateInterval
  setInterval(()=>{refreshSites(Config)}, updateInterval);

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

  app.get('/index.hbs', async function(req, res) {
    if(!isEmpty(sites)){
      const params = {
        sites,
        eluvio_logo: serverHost + ":" + serverPort + "/logo.png",
        date
      };
      res.set('Cache-Control', 'no-cache');
      res.render("index", params);
    }else{
      var template = '<document><loadingTemplate><activityIndicator><text>Server Busy. Restart application.</text></activityIndicator></loadingTemplate></document>';
      res.send(template, 404);
    }
  });

      //Serve the site tvml template
  app.get(['/redeemsite.hbs/:code', '/redeemwatch.hbs/:code'], async function(req, res) {
    try {
      let view = req.path.split('.').slice(0, -1).join('.').substr(1);
      let code = req.params.code;
      console.log("Route "+ view + "/" + code);

      let site = redeemSites[code];
      if(isEmpty(site)){
        site = await redeemCode(Config,code);
        redeemSites[code] = site;
      }

      let titles = site.titles || [];
      let playlists = site.playlists || [];

      const params = {
        title_logo: site.title_logo,
        display_title: site.display_title,
        playlists: playlists,
        titles: titles,
        eluvio_logo: serverHost + ":" + serverPort + "/logo.png",
        site_index: code,
        date
      };

      res.set('Cache-Control', 'no-cache');
      res.render(view, params);
    }catch(e){
      console.error(e);
      var template = '<document><loadingTemplate><activityIndicator><text>Could not load site from code.</text></activityIndicator></loadingTemplate></document>';
      res.send(template, 404);
    }
  });


    //Serve the site tvml template
  app.get(['/site.hbs/:index','/watch.hbs/:index'], async function(req, res) {
    try {
      let view = req.path.split('.').slice(0, -1).join('.').substr(1);
      let index = req.params.index;
      console.log("Route "+ view + "/" + index);
      let site = sites[index];
      let titles = site.titles || [];
      let playlists = site.playlists || [];
      let titleColor = "rgb(236,245,255)";
      // console.log("Site titles: " + JQ(site.titles));
      const params = {
        title_logo: site.title_logo,
        title_color: titleColor,
        display_title: site.display_title,
        playlists: playlists,
        titles: titles,
        eluvio_logo: serverHost + ":" + serverPort + "/logo.png",
        site_index: index,
        date
      };

      res.set('Cache-Control', 'no-cache');
      res.render(view, params);
    }catch(e){
      console.error(e);
      var template = '<document><loadingTemplate><activityIndicator><text>Server Busy. Restart application.</text></activityIndicator></loadingTemplate></document>';
      res.send(template, 404);
    }
  });

    //Serve the title details from versionHash tvml template
    app.get('/detailhash.hbs/:id', async function(req, res) {
    try {
      let view = req.path.split('.').slice(0, -1).join('.').substr(1);
      let id = req.params.id;
      console.log("Route "+ view + "/" + id);
      // console.log(Object.keys(AllTitles));
      let title = AllTitles[id];

      console.log("Found title: " + title.display_title);

      let director = "";
      let genre = "";
      let date = "";
      let cast = [];
      let length = "";
      let offerings = {};
      try {
        offerings = title.availableOfferings || {};
      }catch(e){}
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

      //TODO:
      length = "";

      console.log("Offerings: " + Object.keys(offerings));

      const params = {
        director,
        genre,
        date,
        cast,
        title,
        offerings,
        date
      };
      res.set('Cache-Control', 'no-cache');
      res.render(view, params);
    }catch(e){
      console.error(e);
      var template = '<document><loadingTemplate><activityIndicator><text>Server Busy. Restart application.</text></activityIndicator></loadingTemplate></document>';
      res.send(template, 404);
    }
  });

  const appFunc = async function(req, res) {
    let sessionTag = CreateID(8);
    const params = {
      CONFIG_URL: Config.configUrl,
      UPDATE_INTERVAL: updateInterval,
      SESSION_TAG: sessionTag,
      SITES: sites
    };
    res.type('application/json');
    res.render('application', params);
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

  console.log("Server running on port: " + serverPort);
  
  app.listen(serverPort);
}


main();

exports.app = app;