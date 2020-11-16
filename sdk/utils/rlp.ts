//See: https://github.com/ethereum/wiki/wiki/RLP

import { arrayify, hexlify } from "./bytes";

// Imported Types
import { Arrayish } from "./bytes";

function arrayifyInteger(value: number): Array<number> {
  var result = [];
  while (value) {
    result.unshift(value & 0xff);
    value >>= 8;
  }
  return result;
}

function unarrayifyInteger(
  data: Uint8Array,
  offset: number,
  length: number
): number {
  var result = 0;
  for (var i = 0; i < length; i++) {
    result = result * 256 + data[offset + i];
  }
  return result;
}

function _encode(object: Array<any> | string): Array<number> {
  if (Array.isArray(object)) {
    var payload: Array<number> = [];
    object.forEach(function (child) {
      payload = payload.concat(_encode(child));
    });

    if (payload.length <= 55) {
      payload.unshift(0xc0 + payload.length);
      return payload;
    }

    var length = arrayifyInteger(payload.length);
    length.unshift(0xf7 + length.length);

    return length.concat(payload);
  }

  let data: Array<number> = Array.prototype.slice.call(arrayify(object));

  if (data.length === 1 && data[0] <= 0x7f) {
    return data;
  } else if (data.length <= 55) {
    data.unshift(0x80 + data.length);
    return data;
  }

  var length = arrayifyInteger(data.length);
  length.unshift(0xb7 + length.length);

  return length.concat(data);
}

export function encode(object: any): string {
  return hexlify(_encode(object));
}

type Decoded = {
  result: any;
  consumed: number;
};

function _decodeChildren(
  data: Uint8Array,
  offset: number,
  childOffset: number,
  length: number
): Decoded {
  var result = [];

  while (childOffset < offset + 1 + length) {
    var decoded = _decode(data, childOffset);

    result.push(decoded.result);

    childOffset += decoded.consumed;
    if (childOffset > offset + 1 + length) {
      throw new Error("invalid rlp");
    }
  }

  return { consumed: 1 + length, result: result };
}

// returns { consumed: number, result: Object }
function _decode(
  data: Uint8Array,
  offset: number
): { consumed: number; result: any } {
  if (data.length === 0) {
    throw new Error("invalid rlp data");
  }

  // Array with extra length prefix
  if (data[offset] >= 0xf8) {
    var lengthLength = data[offset] - 0xf7;
    if (offset + 1 + lengthLength > data.length) {
      throw new Error("too short");
    }

    var length = unarrayifyInteger(data, offset + 1, lengthLength);
    if (offset + 1 + lengthLength + length > data.length) {
      throw new Error("to short");
    }

    return _decodeChildren(
      data,
      offset,
      offset + 1 + lengthLength,
      lengthLength + length
    );
  } else if (data[offset] >= 0xc0) {
    var length = data[offset] - 0xc0;
    if (offset + 1 + length > data.length) {
      throw new Error("invalid rlp data");
    }

    return _decodeChildren(data, offset, offset + 1, length);
  } else if (data[offset] >= 0xb8) {
    var lengthLength = data[offset] - 0xb7;
    if (offset + 1 + lengthLength > data.length) {
      throw new Error("invalid rlp data");
    }

    var length = unarrayifyInteger(data, offset + 1, lengthLength);
    if (offset + 1 + lengthLength + length > data.length) {
      throw new Error("invalid rlp data");
    }

    var result = hexlify(
      data.slice(offset + 1 + lengthLength, offset + 1 + lengthLength + length)
    );
    return { consumed: 1 + lengthLength + length, result: result };
  } else if (data[offset] >= 0x80) {
    var length = data[offset] - 0x80;
    if (offset + 1 + length > data.length) {
      throw new Error("invlaid rlp data");
    }

    var result = hexlify(data.slice(offset + 1, offset + 1 + length));
    return { consumed: 1 + length, result: result };
  }
  return { consumed: 1, result: hexlify(data[offset]) };
}

export function decode(data: Arrayish): any {
  let bytes = arrayify(data);
  var decoded = _decode(bytes, 0);
  if (decoded.consumed !== bytes.length) {
    throw new Error("invalid rlp data");
  }
  return decoded.result;
}
