const http = require("http");
const https = require("https");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;

const BINANCE_HOSTS = [
    "api.binance.com",
    "api1.binance.com",
    "api2.binance.com",
    "api3.binance.com"
];

const SYMBOL = "BTCUSDT";

const ALLOWED_INTERVALS = [
    "1m",
    "5m",
    "15m",
    "1h",
    "4h"
];

/* =========================================================
   HTTP JSON RESPONSE
========================================================= */

function sendJSON(res, status, data){

    const body = JSON.stringify(data);

    res.writeHead(status, {
        "Content-Type":"application/json; charset=utf-8",
        "Access-Control-Allow-Origin":"*",
        "Access-Control-Allow-Methods":"GET,OPTIONS",
        "Access-Control-Allow-Headers":"Content-Type",
        "Cache-Control":"no-store"
    });

    res.end(body);
}

/* =========================================================
   BINANCE REQUEST
========================================================= */

function requestBinance(host, path){

    return new Promise((resolve,reject)=>{

        const options={
            hostname:host,
            path:path,
            method:"GET",
            timeout:8000,
            headers:{
                "User-Agent":"IFAN-BTC-ANALYSIS/1.0",
                "Accept":"application/json"
            }
        };

        const req=https.request(
            options,
            response=>{

                let body="";

                response.setEncoding("utf8");

                response.on(
                    "data",
                    chunk=>{
                        body+=chunk;
                    }
                );

                response.on(
                    "end",
                    ()=>{

                        if(
                            response.statusCode<200||
                            response.statusCode>=300
                        ){

                            reject(
                                new Error(
                                    "Binance HTTP "+
                                    response.statusCode
                                )
                            );

                            return;
                        }

                        try{

                            const data=
                                JSON.parse(body);

                            resolve(data);

                        }catch(error){

                            reject(
                                new Error(
                                    "Response Binance bukan JSON"
                                )
                            );
                        }
                    }
                );
            }
        );

        req.on(
            "timeout",
            ()=>{
                req.destroy(
                    new Error(
                        "Binance request timeout"
                    )
                );
            }
        );

        req.on(
            "error",
            error=>{
                reject(error);
            }
        );

        req.end();
    });
}

/* =========================================================
   TRY ALL BINANCE HOSTS
========================================================= */

async function binance(path){

    let lastError=
        new Error("Binance tidak dapat diakses");

    for(const host of BINANCE_HOSTS){

        try{

            return await requestBinance(
                host,
                path
            );

        }catch(error){

            lastError=error;

            console.error(
                "Binance host gagal:",
                host,
                error.message
            );
        }
    }

    throw lastError;
}

/* =========================================================
   MARKET
========================================================= */

async function getMarket(){

    const ticker=await binance(
        "/api/v3/ticker/24hr?symbol="+
        encodeURIComponent(SYMBOL)
    );

    const book=await binance(
        "/api/v3/ticker/bookTicker?symbol="+
        encodeURIComponent(SYMBOL)
    );

    return{

        symbol:SYMBOL,

        price:Number(ticker.lastPrice),

        bid:Number(book.bidPrice),

        ask:Number(book.askPrice),

        high:Number(ticker.highPrice),

        low:Number(ticker.lowPrice),

        volume:Number(ticker.volume),

        change:Number(
            ticker.priceChangePercent
        ),

        timestamp:Date.now()
    };
}

/* =========================================================
   KLINES
========================================================= */

async function getKlines(interval){

    if(!ALLOWED_INTERVALS.includes(interval)){

        throw new Error(
            "Interval tidak diizinkan"
        );
    }

    const limit=200;

    const data=await binance(
        "/api/v3/klines"+
        "?symbol="+
        encodeURIComponent(SYMBOL)+
        "&interval="+
        encodeURIComponent(interval)+
        "&limit="+
        limit
    );

    if(!Array.isArray(data)){

        throw new Error(
            "Data candle Binance tidak valid"
        );
    }

    /*
       Diubah dari array Binance menjadi object
       supaya frontend lebih mudah divalidasi.
    */

    const candles=data
        .filter(
            item=>
                Array.isArray(item)&&
                item.length>=6
        )
        .map(
            item=>({

                time:Number(item[0]),

                open:Number(item[1]),

                high:Number(item[2]),

                low:Number(item[3]),

                close:Number(item[4]),

                volume:Number(item[5])

            })
        );

    return{
        symbol:SYMBOL,
        interval:interval,
        count:candles.length,
        timestamp:Date.now(),
        data:candles
    };
}

/* =========================================================
   SERVER
========================================================= */

const server=http.createServer(
    async (req,res)=>{

        if(req.method==="OPTIONS"){

            res.writeHead(204,{
                "Access-Control-Allow-Origin":"*",
                "Access-Control-Allow-Methods":"GET,OPTIONS",
                "Access-Control-Allow-Headers":"Content-Type"
            });

            res.end();

            return;
        }

        try{

            const url=new URL(
                req.url,
                `http://${req.headers.host}`
            );

            /* HEALTH */

            if(
                req.method==="GET"&&
                url.pathname==="/api/health"
            ){

                sendJSON(
                    res,
                    200,
                    {
                        ok:true,
                        service:"IFAN BTC ANALYSIS SERVER",
                        symbol:SYMBOL,
                        time:Date.now()
                    }
                );

                return;
            }

            /* MARKET */

            if(
                req.method==="GET"&&
                url.pathname==="/api/market"
            ){

                const market=
                    await getMarket();

                sendJSON(
                    res,
                    200,
                    market
                );

                return;
            }

            /* KLINES */

            if(
                req.method==="GET"&&
                url.pathname==="/api/klines"
            ){

                const interval=
                    url.searchParams.get(
                        "interval"
                    )||"1m";

                const result=
                    await getKlines(
                        interval
                    );

                sendJSON(
                    res,
                    200,
                    result
                );

                return;
            }

            /* ROOT */

            if(
                req.method==="GET"&&
                url.pathname==="/"
            ){

                sendJSON(
                    res,
                    200,
                    {
                        ok:true,
                        name:"IFAN BTC ANALYSIS SERVER",
                        endpoints:[
                            "/api/health",
                            "/api/market",
                            "/api/klines?interval=1m"
                        ]
                    }
                );

                return;
            }

            sendJSON(
                res,
                404,
                {
                    ok:false,
                    error:"Endpoint tidak ditemukan"
                }
            );

        }catch(error){

            console.error(
                "SERVER ERROR:",
                error
            );

            sendJSON(
                res,
                502,
                {
                    ok:false,
                    error:error.message||
                        "Server error"
                }
            );
        }
    }
);

server.listen(
    PORT,
    "0.0.0.0",
    ()=>{
        console.log(
            "================================"
        );

        console.log(
            "IFAN BTC ANALYSIS SERVER"
        );

        console.log(
            "PORT:",
            PORT
        );

        console.log(
            "STATUS: RUNNING"
        );

        console.log(
            "================================"
        );
    }
);
