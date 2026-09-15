'use strict';

const { CODE } = require('../constants');

/**
 * 业务异常。桥接层据 code 直接映射为统一返回结构，不向界面暴露堆栈。
 */
class BizError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BizError';
    this.code = code;
  }

  static badRequest(message) {
    return new BizError(CODE.BAD_REQUEST, message || '参数校验失败');
  }

  static unauthorized(message) {
    return new BizError(CODE.UNAUTHORIZED, message || '登录状态已失效，请重新登录');
  }

  static forbidden(message) {
    return new BizError(CODE.FORBIDDEN, message || '无权限执行该操作');
  }

  static notFound(message) {
    return new BizError(CODE.NOT_FOUND, message || '记录不存在');
  }

  static conflict(message) {
    return new BizError(CODE.CONFLICT, message || '数据已存在');
  }
}

module.exports = { BizError };
