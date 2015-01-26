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

    var reg = /@@include\([^()]*\)/g;
    var pathReg = /\(\s*(("[^"]*")|('[^']*'))/;     //获取@@include("./test2.html")中的("./test2.html" 字符
    var pathReg_2 = /(^\(\s*("|')\s*)|(\s*("|')$)/g;    //过滤("./test2.html" 字符中的多余字符
    var jsonReg = /\{[\S\s]*\}/g;
    var argReg = /@{2}(\{|)[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*(\s|)(\}|)/g;     //匹配变量，变量写法可以为@@key.value或@@{key.value}

    var taskName = "includereplace";

    grunt.registerMultiTask(taskName, 'Include files and replace variables', function () {
        var task = this.nameArgs.split(":")[1];
        var config = grunt.config.get(taskName);

        //获取全局变量并且合并
        var globals = ("options" in config) ? (config.options.globals || {}) : {};

        config = config[task];

        var taskGlobal = ("options" in config) ? (config.options.globals || {}) : {};
        _.extend(globals, taskGlobal);

        var cache = {};

        var destFileArr = getDestFiles();

        var date = new Date()
        //遍历匹配文件
        this.files.forEach(function (file) {
            for (var i = 0; i < file.src.length; i++) {
                var filePath = file.src[i];
                var fileName = filePath.split("/")[filePath.split("/").length - 1];

                //检查路径和文件合法性，同时忽略带下划线前缀文件
                if (!grunt.file.exists(filePath) || !grunt.file.isFile(filePath) || fileName.match(/^_+/g)) continue;

                var str = grunt.file.read(filePath);

                str = replace(str, filePath);

                grunt.log.debug('Saving to', file.dest);

                grunt.file.write(file.dest, str);

                grunt.log.ok('Processed ' + filePath);
            }

            var index;
            (index = destFileArr.indexOf(file.dest)) >= 0 && [].splice.call(destFileArr, index, 1);
        });

        //删除多余文件
        destFileArr.forEach(function (file) {
            grunt.log.ok('Deleted ' + file);
            grunt.file.delete(file);
        });

        console.log("time："+((new Date()) - date));

        //获取目标文件夹下的文件列表
        function getDestFiles() {
            if (grunt.file.exists(config.dest) && !grunt.file.isFile(config.dest)) {
                return grunt.file.expand(config.dest + "**/*");
            } else return [];
        }

        function replace(str, filePath) {
            var arrs = str.match(reg);

            if (!arrs) return str;

            //@@include替换
            arrs.forEach(function (arr) {
                var fileUrl = arr.match(pathReg)[0].replace(pathReg_2, '');

                try {
                    var json = arr.match(jsonReg);
                    //之所以使用eval而不使用JSON.parse是因为eval对转化的兼容性更好
                    json = json && eval("("+json[0]+")");
                    _.extend(globals, json || {});
                } catch (e) {
                    console.log(e)
                }

                fileUrl = url.resolve(filePath, fileUrl);

                var conContain;
                if (fileUrl in cache) {
                    conContain = cache[fileUrl];
                } else {
                    var txt = replace(grunt.file.read(fileUrl), fileUrl)

                    conContain = cache[fileUrl] = {
                        content: txt,
                        args: txt.match(argReg) || []
                    };
                }

                str = str.replace(arr, function (m) {
                    var val = conContain.content;
                    var args;

                    if (!_.isEmpty(globals) && !!(args = [].slice.call(conContain.args)).length) {
                        while (args.length) {
                            var reTxt = args.pop();
                            var arg = ''.split.call(reTxt.replace(/@{2}|\{|\}/g,''), '.');

                            var o = globals;
                            for (var i = 0; i < arg.length; i++) {
                                if (arg[i] in o) {
                                    if ((i == arg.length - 1) && (typeof o[arg[i]]=='string'||'number')) {
                                        val = val.replace(reTxt , o[arg[i]]);
                                    } else o = o[arg[i]];
                                } else break;
                            }
                        }
                    }
                    return val;
                });
            });

            return str;
        }
    });
};
