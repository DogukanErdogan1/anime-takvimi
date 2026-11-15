window.AnimeOfflineReady=import('/site/offline-client.mjs').then(module=>{window.AnimeOffline=module.installOfflineClient();return window.AnimeOffline;}).catch(()=>null);
