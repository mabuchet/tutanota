// @flow
import m from "mithril"
import {assertMainOrNode} from "../api/Env"
import {Dialog} from "../gui/base/Dialog"
import {ColumnWidth, Table} from "../gui/base/Table"
import {lang} from "../misc/LanguageViewModel"
import TableLine from "../gui/base/TableLine"
import {isTutanotaMailAddress} from "../api/common/RecipientInfo"
import {InvalidDataError, LimitReachedError} from "../api/common/error/RestError"
import {worker} from "../api/main/WorkerClient"
import {AccountType, OperationType, TUTANOTA_MAIL_ADDRESS_DOMAINS} from "../api/common/TutanotaConstants"
import {LazyLoaded} from "../api/common/utils/LazyLoaded"
import {CustomerTypeRef} from "../api/entities/sys/Customer"
import {load} from "../api/main/Entity"
import {CustomerInfoTypeRef} from "../api/entities/sys/CustomerInfo"
import {addAll} from "../api/common/utils/ArrayUtils"
import {neverNull} from "../api/common/utils/Utils"
import {SelectMailAddressForm} from "./SelectMailAddressForm"
import {showNotAvailableForFreeDialog} from "../misc/ErrorHandlerImpl"
import {isSameId} from "../api/common/EntityFunctions"
import {GroupInfoTypeRef} from "../api/entities/sys/GroupInfo"
import {BookingTypeRef} from "../api/entities/sys/Booking"
import {Button, ButtonType, createDropDownButton} from "../gui/base/Button"
import {ExpanderButton, ExpanderPanel} from "../gui/base/Expander"
import {logins} from "../api/main/LoginController"
import {Icons} from "../gui/base/icons/Icons"
import {showProgressDialog} from "../gui/base/ProgressDialog"
import type {EntityUpdateData} from "../api/main/EventController"
import {isUpdateForTypeRef} from "../api/main/EventController"
import {getAvailableDomains} from "./AddUserDialog"

assertMainOrNode()

export class EditAliasesForm {
	view: Function;

	_userGroupInfo: GroupInfo;
	_aliasesTable: Table;
	_nbrOfAliases: number;

	constructor(userGroupInfo: GroupInfo) {
		this._nbrOfAliases = 0
		let addAliasButton = new Button("addEmailAlias_label", () => this._showAddAliasDialog(), () => Icons.Add)
		this._aliasesTable = new Table(["emailAlias_label", "state_label"], [
			ColumnWidth.Largest, ColumnWidth.Small
		], true, addAliasButton)
		let expander = new ExpanderButton("showEmailAliases_action", new ExpanderPanel(this._aliasesTable), false)

		this.view = () => {
			return [
				m(".flex-space-between.items-center.mt-l.mb-s", [
					m(".h4", lang.get('mailAddressAliases_label')),
					m(expander)
				]),
				m(expander.panel),
				m(".small", (this._nbrOfAliases === 0) ?
					lang.get("adminMaxNbrOfAliasesReached_msg")
					: lang.get('mailAddressAliasesMaxNbr_label', {'{1}': this._nbrOfAliases}))
			]
		}

		this._updateAliases(userGroupInfo)
	}

	_updateNbrOfAliasesMessage() {
		return worker.getAliasCounters().then(mailAddressAliasServiceReturn => {
			this._nbrOfAliases = Math.max(0, Number(mailAddressAliasServiceReturn.totalAliases)
				- Number(mailAddressAliasServiceReturn.usedAliases))
			m.redraw()
		})
	}

	_showAddAliasDialog() {
		if (this._nbrOfAliases === 0) {
			if (logins.getUserController().isFreeAccount()) {
				showNotAvailableForFreeDialog(true)
			} else {
				Dialog.confirm(() => lang.get("adminMaxNbrOfAliasesReached_msg") + " "
					+ lang.get("orderAliasesConfirm_msg")).then(confirmed => {
					if (confirmed) {
						// TODO: Navigate to alias upgrade
						//tutao.locator.navigator.settings();
						//tutao.locator.settingsViewModel.show(tutao.tutanota.ctrl.SettingsViewModel.DISPLAY_ADMIN_PAYMENT);
					}
				})
			}
		} else {
			getAvailableDomains().then(domains => {
				let form = new SelectMailAddressForm(domains)
				let addEmailAliasOkAction = (dialog) => {
					let p = worker.addMailAlias(this._userGroupInfo.group, form.getCleanMailAddress())
					              .catch(InvalidDataError, () => {
						              Dialog.error("mailAddressNA_msg")
					              })
					              .catch(LimitReachedError, () => {
						              Dialog.error("adminMaxNbrOfAliasesReached_msg")
					              })
					showProgressDialog("pleaseWait_msg", p)
					dialog.close()
				}

				Dialog.showActionDialog({
					title: lang.get("addEmailAlias_label"),
					child: form,
					validator: () => form.getErrorMessageId(),
					okAction: addEmailAliasOkAction
				})
			})
		}
	}

	_updateAliases(userGroupInfo: GroupInfo) {
		this._userGroupInfo = userGroupInfo
		this._aliasesTable.updateEntries(userGroupInfo.mailAddressAliases.map(alias => {
			let actionButton = createDropDownButton("edit_action", () => Icons.Edit, () => {
				return [
					new Button("activate_action", () => {
						if (!alias.enabled) {
							this._switchStatus(alias)
						}
					}).setType(ButtonType.Dropdown).setSelected(() => alias.enabled),
					new Button(isTutanotaMailAddress(alias.mailAddress) ? "deactivate_action" : "delete_action", () => {
						if (alias.enabled) {
							this._switchStatus(alias)
						}
					}).setType(ButtonType.Dropdown).setSelected(() => !alias.enabled)
				]
			})
			return new TableLine([
				alias.mailAddress, alias.enabled ? lang.get("activated_label") : lang.get("deactivated_label")
			], actionButton)
		}))
		this._updateNbrOfAliasesMessage()
	}

	_switchStatus(alias: MailAddressAlias) {
		let restore = !alias.enabled
		let promise = Promise.resolve(true)
		if (!restore) {
			let message = isTutanotaMailAddress(alias.mailAddress) ? 'deactivateAlias_msg' : 'deleteAlias_msg'
			promise = Dialog.confirm(() => lang.get(message, {"{1}": alias.mailAddress}))
		}
		promise.then(confirmed => {
			if (confirmed) {
				let p = worker.setMailAliasStatus(this._userGroupInfo.group, alias.mailAddress, restore)
				              .catch(LimitReachedError, e => {
					              Dialog.error("adminMaxNbrOfAliasesReached_msg")
				              })
				showProgressDialog("pleaseWait_msg", p)
			}
		})
	}

	entityEventReceived(update: EntityUpdateData): void {
		const {instanceListId, instanceId, operation} = update
		if (isUpdateForTypeRef(GroupInfoTypeRef, update) && operation === OperationType.UPDATE) {
			if (isSameId(this._userGroupInfo._id, [neverNull(instanceListId), instanceId])) {
				// the aliases of this user may have changed
				load(GroupInfoTypeRef, [neverNull(instanceListId), instanceId]).then(groupInfo => {
					this._updateAliases(groupInfo)
				})
			} else {
				// other users may have taken aliases
				this._updateAliases(this._userGroupInfo)
			}
		} else if (isUpdateForTypeRef(CustomerInfoTypeRef, update) && operation === OperationType.UPDATE) {
			// the number of free aliases may have been changed
			this._updateAliases(this._userGroupInfo)
		} else if (isUpdateForTypeRef(BookingTypeRef, update)) {
			// the booked alias package may have changed
			this._updateAliases(this._userGroupInfo)
		}
	}
}

