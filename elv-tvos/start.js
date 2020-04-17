var express = require('express');
var exbars = require('exbars');
var Fabric = require('./server/fabric');
var Site = require('./server/site');
var Config = require('./config.json');
var {JQ,isEmpty} = require('./server/utils')


const main = async () => {
  let configUrl = Config.configUrl;
  let siteId = Config.siteId;
  let serverHost = Config.serverHost;
  let serverPort = Config.serverPort || 4001;
  let privateKey = process.env.PRIVATEKEY;

  if(isEmpty(configUrl)){
    console.error("configUrl not set in config.");
    process.exit(1);
  }

  if(isEmpty(siteId)){
    console.error("siteId not set in config.");
    process.exit(1);
  }

  if(isEmpty(privateKey)){
    console.error("Please 'export PRIVATEKEY=XXXX' before running.");
    process.exit(1);
  }

  var app = express();

  app.engine('hbs', exbars({defaultLayout: false}));
  app.set('view engine', 'hbs');



  app.get('/index.hbs', async function(req, res) {

    let fabric = new Fabric;
    await fabric.init({configUrl,privateKey});
    let site = new Site({fabric, siteId});
    await site.loadSite();

    const params = {
      title_logo: site.siteInfo.title_logo,
      display_title: site.siteInfo.display_title,
      playlists: site.siteInfo.playlists,
      eluvio_logo: serverHost + ":" + serverPort + "/logo.png"
    };
    res.render('index', params);
  });
  
  app.use(express.static('static'));
  console.log("Server running on port: " + serverPort);
  
  app.listen(serverPort);
}


main();