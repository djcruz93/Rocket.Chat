import { Meteor } from 'meteor/meteor';
import { Match, check } from 'meteor/check';
import { Random } from 'meteor/random';

import { Messages, Rooms } from '../../../../models';
import { settings as rcSettings } from '../../../../settings';
import { API } from '../../../../api/server';
import { findGuest, getRoom, settings } from '../lib/livechat';
import { SystemLogger } from '../../../../logger/server';
import { hasPermission, canSendMessage } from '../../../../authorization';
import { Livechat } from '../../lib/Livechat';

API.v1.addRoute('livechat/video.call/:token', {
	get() {
		try {
			check(this.urlParams, {
				token: String,
			});

			check(this.queryParams, {
				rid: Match.Maybe(String),
			});

			const { token } = this.urlParams;

			const guest = findGuest(token);
			if (!guest) {
				throw new Meteor.Error('invalid-token');
			}

			const rid = this.queryParams.rid || Random.id();
			const roomInfo = { jitsiTimeout: new Date(Date.now() + 3600 * 1000) };
			const { room } = getRoom({ guest, rid, roomInfo });
			const config = settings();
			if (!config.theme || !config.theme.actionLinks || !config.theme.actionLinks.jitsi) {
				throw new Meteor.Error('invalid-livechat-config');
			}

			Messages.createWithTypeRoomIdMessageAndUser('livechat_video_call', room._id, '', guest, {
				actionLinks: config.theme.actionLinks.jitsi,
			});
			let rname;
			if (rcSettings.get('Jitsi_URL_Room_Hash')) {
				rname = rcSettings.get('uniqueID') + rid;
			} else {
				rname = encodeURIComponent(room.t === 'd' ? room.usernames.join(' x ') : room.name);
			}
			const videoCall = {
				rid,
				domain: rcSettings.get('Jitsi_Domain'),
				provider: 'jitsi',
				room: rcSettings.get('Jitsi_URL_Room_Prefix') + rname + rcSettings.get('Jitsi_URL_Room_Suffix'),
				timeout: new Date(Date.now() + 3600 * 1000),
			};

			return API.v1.success({ videoCall });
		} catch (e) {
			return API.v1.failure(e);
		}
	},
});

API.v1.addRoute('livechat/webrtc.call', { authRequired: true }, {
	get() {
		try {
			check(this.queryParams, {
				rid: Match.Maybe(String),
			});

			if (!hasPermission(this.userId, 'view-l-room')) {
				return API.v1.unauthorized();
			}

			const room = canSendMessage(this.queryParams.rid, {
				uid: this.userId,
				username: this.user.username,
				type: this.user.type,
			});
			if (!room) {
				throw new Meteor.Error('invalid-room');
			}

			const webrtcCallingAllowed = (rcSettings.get('WebRTC_Enabled') === true) && (rcSettings.get('Omnichannel_call_provider') === 'WebRTC');
			if (!webrtcCallingAllowed) {
				throw new Meteor.Error('webRTC calling not enabled');
			}

			const config = settings();
			if (!config.theme || !config.theme.actionLinks || !config.theme.actionLinks.webrtc) {
				throw new Meteor.Error('invalid-livechat-config');
			}

			if (!room.callStatus || room.callStatus === 'ended' || room.callStatus === 'declined') {
				Rooms.setCallStatus(room._id, 'ringing');
				Messages.createWithTypeRoomIdMessageAndUser(
					'livechat_webrtc_video_call',
					room._id,
					'Join my room to start the video call',
					this.user,
					{
						actionLinks: config.theme.actionLinks.webrtc,
						callStatus: 'ringing',

					},
				);
			}
			const videoCall = {
				rid: room._id,
				provider: 'webrtc',
				callStatus: room.callStatus,
			};
			return API.v1.success({ videoCall });
		} catch (e) {
			SystemLogger.error('Error starting webRTC video call:', e);
			return API.v1.failure(e);
		}
	},
});

API.v1.addRoute('livechat/webrtc.call/:callId', { authRequired: true }, {
	put() {
		try {
			check(this.urlParams, {
				callId: String,
			});

			check(this.bodyParams, {
				rid: Match.Maybe(String),
				status: Match.Maybe(String),
			});

			if (!hasPermission(this.userId, 'view-l-room')) {
				return API.v1.unauthorized();
			}

			const room = canSendMessage(this.queryParams.rid, {
				uid: this.userId,
				username: this.user.username,
				type: this.user.type,
			});
			if (!room) {
				throw new Meteor.Error('invalid-room');
			}

			const { callId } = this.urlParams;
			const { rid, status } = this.bodyParams;

			const call = Messages.findOneById(callId);
			if (!call || call.t !== 'livechat_webrtc_video_call') {
				throw new Meteor.Error('invalid-callId');
			}

			Livechat.updateCallStatus(callId, rid, status);

			return API.v1.success({ status });
		} catch (e) {
			return API.v1.failure(e);
		}
	},
});
