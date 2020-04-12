var express = require('express');
var exbars = require('exbars');
var Fabric = require('./server/fabric');
var Site = require('./server/site');
var {JQ,isEmpty} = require('./server/utils')
const main = async () => {
  let configUrl = "https://demov3.net955210.contentfabric.io/config";
  let siteId = "iq__3iSbvsnE1vdEYQvozg3wPg8i8sgV";
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

  console.log("Initializing Fabric.");
  let fabric = new Fabric;
  await fabric.init({configUrl,privateKey});
  let site = new Site({fabric, siteId});
  await site.loadSite();

  var app = express();

  app.engine('hbs', exbars({defaultLayout: false}));
  app.set('view engine', 'hbs');

  const params = {
    display_title: site.siteInfo.display_title,
    playlists: site.siteInfo.playlists
  };
  
  app.get('/index.hbs', function(req, res) {
    res.render('index', params);
  });
  
  app.use(express.static('static'));
  
  app.listen(3000);
}


main();