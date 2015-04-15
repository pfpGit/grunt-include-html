/*
 * grunt-html-replace
 * https://github.com/whxaxes/grunt-include-html
 *
 * Copyright (c) 2015 wanghx
 * Licensed under the MIT license.
 */

module.exports = function (grunt) {
    'use strict';

    var _ = grunt.util._;
    var url = require('url');
    var crypto = require('crypto');

    //匹配@@include("")
    var reg = /@{2}include\(\s*["'].*\s*["']\s*(,\s*\{[\s\S]*?\})?\)/g;

    //获取@@include("XXX")中的"XXX"字符
    var pathReg = /["'] *.*? *["']/;

    //判断@@include中的json字符串
    var jsonReg = /\{[\S\s]*\}/g;

    //匹配变量，变量写法可以为@@key.value或@@{key.value}
    var argReg = /@{2}(\{|)[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*(\s|)(\}|)/g;

    //匹配<!--#remove-->****<!--/remove-->，并且删除****中的内容
    var removeReg = /<!-*#remove-*>[\s\S]*?<!-*\/remove-*>/g

    var taskName = "includereplace";

    var dex = __filename.split("\\");
    var fileConfigPath = dex.slice(0 , dex.length-2).join("/")+"/config.ir";

    grunt.registerMultiTask(taskName, 'Include files and replace variables', function () {
        var task = this.nameArgs.split(":")[1];
        var config = grunt.config.get(taskName);

        //获取全局变量并且合并
        var globals = ("options" in config) ? (config.options.globals || {}) : {};
        var noConfig = ("options" in config) ? !!config.options.ncon : false;

        config = config[task];

        var taskGlobal = ("options" in config) ? (config.options.globals || {}) : {};
        _.extend(globals, taskGlobal);

        var cache = {};

        //获取文件缓存的信息
        if(!noConfig){
            try{
                var fileConfig = !noConfig ? grunt.file.readJSON(fileConfigPath) : {};
            }catch(e){
                fileConfig = {}
            }
            var newFileConfig = {};
        }

        var destFileArr = getDestFiles();
        var destStr = "";
        var date = new Date();
        //遍历匹配文件
        this.files.forEach(function (file) {
            for (var i = 0; i < file.src.length; i++) {
                var filePath = file.src[i];
                var fileName = filePath.split("/")[filePath.split("/").length - 1];

                //检查路径和文件合法性，同时忽略带下划线前缀文件
                if (!grunt.file.exists(filePath) || !grunt.file.isFile(filePath) || fileName.match(/^_+/g)) continue;

                var str = replace(grunt.file.read(filePath), filePath).replace(removeReg , '');

                //如果文件MD5值跟缓存相同，则不进行复写
                if(!noConfig && checkCache(file.dest , str)) continue;

                grunt.log.debug('Saving to', file.dest);
                grunt.file.write(file.dest, str);
                grunt.log.ok('Processed ' + filePath);
            }

            var index;
            destStr += file.dest+",";
            (index = destFileArr.indexOf(file.dest)) >= 0 && [].splice.call(destFileArr, index, 1);
        });

        if(!noConfig && !_.isEmpty(newFileConfig)){
            grunt.file.write(fileConfigPath , JSON.stringify(newFileConfig))
        }

        //删除多余文件
        destFileArr.forEach(function (file) {
            if(grunt.file.isFile(file) || (grunt.file.isDir(file) && destStr.indexOf(file+"/")==-1)){
                grunt.log.ok('Deleted ' + file);
                grunt.file.delete(file);
            }
        });
        console.log("time："+((new Date()) - date)+"ms");

        //获取目标文件夹下的文件列表
        function getDestFiles() {
            if (grunt.file.exists(config.dest) && !grunt.file.isFile(config.dest)) {
                try{
                    return grunt.file.expand(config.dest + "**/*");
                }catch(e){
                    return []
                }
            } else return [];
        }

        //检查缓存是否存在
        function checkCache(key , value) {
            value = crypto.createHash("md5").update(value).digest("hex");
            newFileConfig[key] = value;
            if((key in fileConfig) && fileConfig[key]===value)return true;

            return false;
        }

        //由于underscore的clone是浅拷贝，所以实现一个略深的拷贝封装
        function deepClone(obj){
            if (typeof(obj) != 'object') return obj;

            if (obj instanceof Array) return obj.slice(0);

            var re = {};
            for (var k in obj) {
                re[k] = deepClone(obj[k]);
            }
            return re;
        }

        //替换逻辑
        function replace(str, filePath) {
            var arrs = str.match(reg) || [];

            if (!arrs.length && !str.match(argReg)) return str;

            var o = deepClone(globals);

            str = str.replace(argReg , function(reTxt){
                if(reTxt=="@@include")return reTxt;

                reValSync(reTxt , o , function(result){
                    reTxt = result
                })

                return reTxt
            })

            //@@include替换
            arrs.forEach(function (arr) {
                var fileUrl = arr.match(pathReg)[0].replace(/"|'| /g, '');
                fileUrl = url.resolve(filePath, fileUrl);

                var conContain;
                if (fileUrl in cache) {
                    conContain = cache[fileUrl];
                } else {
                    var txt = replace(grunt.file.read(fileUrl), fileUrl);

                    conContain = cache[fileUrl] = {
                        content: txt,
                        args: txt.match(argReg) || []
                    };
                }

                try {
                    var json = arr.match(jsonReg);
                    //之所以使用eval而不使用JSON.parse是因为eval对转化的兼容性更好
                    json = json && eval("("+json[0].replace(/\r\n/,'')+")");
                    _.extend(o, json || {});
                } catch (e) {
                    console.log(e)
                }

                //替换变量的值
                str = str.replace(arr, function (m) {
                    var val = conContain.content;
                    var args;

                    if (_.isEmpty(o) || !(args = [].slice.call(conContain.args)).length) return val;

                    while (args.length) {
                        var reTxt = args.pop();

                        reValSync(reTxt , o , function(result){
                            val = val.replace(reTxt , result);
                        })
                    }
                    return val;
                });
            });
            return str;
        }

        //变量更改方法
        function reValSync(reTxt , o , callback){
            var arg = ''.split.call(reTxt.replace(/@{2}|\{|\}|\s/g,''), '.');

            for (var i = 0; i < arg.length; i++) {
                if (!(arg[i] in o)) break;

                if ((i == arg.length - 1) && (typeof o[arg[i]]=='string'||'number')) {
                    callback(o[arg[i]]);
                    break;
                } else o = o[arg[i]];
            }
        }

    });
};
