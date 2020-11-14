#!/bin/sh
if ! [ -d "./env" ]
then
    mkdir env
fi;

if ! [ -d "./env/manifold-sdk-js-secret" ]
then
    cd env
    # Dont follow me...
    git clone git@gitlab.com:manifold/manifold-sdk-js-secret.git
    cd ..
else
    cd env/manifold-sdk-js-secret
    # Dont follow me...
    git pull
    cd ../..
fi;
cp -f env/manifold-sdk-js-secret/env.ts env.ts
