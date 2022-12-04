/* Copyright 2021 Binovo IT Human Project SL
   Copyright 2022 Landoo Sistemas de Informacion SL
   License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).
*/

odoo.define("l10n_es_ticketbai_pos.models", function (require) {
    "use strict";

    const {Gui} = require("point_of_sale.Gui");
    const models = require("point_of_sale.models");
    const pos_super = models.PosModel.prototype;
    const order_super = models.Order.prototype;
    const orderLine_super = models.Orderline.prototype;
    const core = require("web.core");
    const _t = core._t;
    const tbai_models = require("l10n_es_ticketbai_pos.tbai_models");
    const rpc = require("web.rpc");

    const tbai = window.tbai;

    models.load_fields("res.company", [
        "tbai_enabled", "tbai_test_enabled", "tbai_license_key", "tbai_developer_id",
        "tbai_software_name", "tbai_tax_agency_id", "tbai_protected_data",
        "tbai_protected_data_txt",
    ]);

    models.load_fields("res.country", ["code"]);
    models.load_fields("res.partner", ["tbai_partner_idtype", "tbai_partner_identification_number",
]);

    models.load_models([
        {
            model: "res.partner",
            fields: ["vat", "country_id", "tbai_partner_idtype", "tbai_partner_identification_number",],
            condition: function (self) {
                return self.company.tbai_enabled;
            },
            domain: function (self) {return [["customer_rank", "=", 0], ["id", "=", self.company.tbai_developer_id[0]],];},
            loaded: function (self, partner) {
                if (partner.length === 1 && !self.db.get_partner_by_id(partner[0].id)) {
                    self.partners.concat(partner);
                    self.db.add_partners(partner);
                }
            },
        },
        {
            model: "tbai.invoice",
            fields: ["signature_value", "number_prefix", "number", "expedition_date"],
            condition: function (self) {
                return self.company.tbai_enabled;
            },
            domain: function (self) {
                return [["id", "=", self.config.tbai_last_invoice_id[0]]];
            },
            loaded: function (self, tbai_invoices) {
                if (Array.isArray(tbai_invoices) && tbai_invoices.length === 1) {
                    let tbai_inv = tbai_invoices[0];
                    let tbai_last_invoice_data = {
                        order: {simplified_invoice: tbai_inv.number_prefix + tbai_inv.number,},
                        signature_value: tbai_inv.signature_value,
                        number: tbai_inv.number,
                        number_prefix: tbai_inv.number_prefix,
                        expedition_date: moment(tbai_inv.expedition_date, "DD-MM-YYYY").toDate(),
                    };
                    self.set("tbai_last_invoice_data", tbai_last_invoice_data);
                }
            },
        },
        {
            model: "pos.config",
            fields: ["id"],
            condition: function (self) {
                return self.company.tbai_enabled;
            },
            domain: function (self) {return [["id", "=", self.pos_session.config_id[0]]];},
            loaded: function (self, configs) {
                self.set_tbai_last_invoice_data(self.get_tbai_last_invoice_data());
                return rpc.query({
                        model: "pos.config",
                        method: "get_tbai_p12_and_friendlyname",
                        args: [configs[0].id],
                    }).then(function (args) {
                        return tbai.TbaiSigner.fromBuffer(
                            atob(args[0]), args[1], args[2]
                        ).then(function (signer) {
                                self.tbai_signer = signer;
                        }, function (err) {
                            console.error(err);
                        });
                    });
                },
            },
            {
                model: "tbai.tax.agency",
                fields: ["version", "qr_base_url", "test_qr_base_url"],
                condition: function (self) {
                    return self.company.tbai_enabled;
                },
                domain: function (self) {
                    return [["id", "=", self.company.tbai_tax_agency_id[0]]];
                },
                loaded: function (self, tax_agencies) {
                    self.tbai_version = tax_agencies[0].version;
                    if (self.company.tbai_test_enabled) {
                        self.tbai_qr_base_url = tax_agencies[0].test_qr_base_url;
                    } else {
                        self.tbai_qr_base_url = tax_agencies[0].qr_base_url;
                    }
                },
            },
        {
            model: "tbai.vat.regime.key",
            fields: ["code"],
            condition: function (self) {
                return self.company.tbai_enabled;
            },
            domain: [],
            loaded: function (self, vat_regime_keys) {
                self.tbai_vat_regime_keys = vat_regime_keys;
            },
        },
    ]);

    models.PosModel = models.PosModel.extend({
        initialize: function(attributes) {
            this.tbai_version = null;
            this.tbai_signer = null;
            this.tbai_qr_base_url = null;
            this.tbai_vat_regime_keys = null;
            this.set({'tbai_last_invoice_data': null});
            pos_super.initialize.apply(this, arguments);
        },
        get_country_by_id: function (id) {
            let countries = this.countries;
            let country = null;
            let i = 0;
            while (country === null && i < countries.length) {
                if (id === countries[i].id) {
                    country = countries[i];
                }
                i++;
            }
            return country;
        },
        get_country_code_by_id: function (id) {
            let country = this.get_country_by_id(id);
            return (country && country.code.toUpperCase()) || null;
        },
        get_tbai_vat_regime_key_by_id: function (id) {
            let vat_regime_keys = this.tbai_vat_regime_keys;
            let vat_regime_key = null;
            let i = 0;
            while (vat_regime_key === null && i < vat_regime_keys.length) {
                if (id === vat_regime_keys[i].id) {
                    vat_regime_key = vat_regime_keys[i];
                }
                i++;
            }
            return vat_regime_key;
        },
        get_tbai_vat_regime_key_code_by_id: function (id) {
            let tbai_vat_regime_key = this.get_tbai_vat_regime_key_by_id(id);
            return (tbai_vat_regime_key && tbai_vat_regime_key.code) || null;
        },
        update_tbai_last_invoice_data: function(tbai_inv) {
            let self = this;
            let tbai_last_invoice_data = {
                order: {simplified_invoice: tbai_inv.number_prefix + tbai_inv.number},
                signature_value: tbai_inv.signature_value,
                number: tbai_inv.number,
                number_prefix: tbai_inv.number_prefix,
                expedition_date: tbai_inv.expedition_date
            };
            self.set_tbai_last_invoice_data(tbai_last_invoice_data);
        },
        push_single_order: function(order, opts) {
            let self = this;
            if (this.company.tbai_enabled && order && order.is_simplified_invoice) {
                return order.tbai_current_invoice.then(function(tbai_inv) {
                    if (order.l10n_es_unique_id !== tbai_inv.number_prefix + tbai_inv.number) {
                        order.tbai_warning_msg = _.str.sprintf(
                            'An error has occurred when generating the ticket number %s. The simplified_invoice and tbai_inv.number are different (%s).',
                             order.l10n_es_unique_id,
                             tbai_inv.number_prefix + tbai_inv.number
                        );
                        return tbai_inv.build_invoice().then(function() {
                            Gui.showPopup("ErrorPopup", {
                                title: _t('TicketBAI'),
                                body: _.str.sprintf(
                                    _t('An error has occurred when generating the ticket number %s. Reprint it from the order list.'),
                                    order.l10n_es_unique_id
                                )
                            });
                            self.update_tbai_last_invoice_data(tbai_inv);
                            return pos_super.push_single_order.call(self, order, opts);
                        });
                    } else {
                        self.update_tbai_last_invoice_data(tbai_inv);
                        return pos_super.push_single_order.call(self, order, opts);
                    }
                });
            } else {
                return pos_super.push_single_order.call(self, order, opts);
            }
        },
        get_tbai_last_invoice_data: function () {
            let db_json_last_invoice_data = this.db.get_tbai_json_last_invoice_data();
            if (!(Object.keys(db_json_last_invoice_data).length === 0)) {
                return db_json_last_invoice_data;
            }
            else {
                return this.get("tbai_last_invoice_data") || null;
            }
        },
        set_tbai_last_invoice_data: function (data) {
            this.set("tbai_last_invoice_data", data);
            this.db.set_tbai_json_last_invoice_data(data);
        },
        scan_product: function (parsed_code) {
            let res;
            let ok = true;
            if (this.company.tbai_enabled) {
                let product = this.db.get_product_by_barcode(parsed_code.base_code);
                if (product && (product.taxes_id !== 1)) {
                    ok = false;
                    Gui.showPopup("ErrorPopup", {
                        title: _t("TicketBAI"),
                        body: _.str.sprintf(
                            _t("Please set a tax for product %s."),
                            product.display_name
                        ),
                    });
                }
            }
            if (ok) {
                res = pos_super.scan_product.call(this, parsed_code);
            } else {
                res = true;
            }
            return res;
        },
    });

    models.Orderline = models.Orderline.extend({
        export_as_JSON: function () {
            let json = orderLine_super.export_as_JSON.apply(this, arguments);
            if (this.pos.company.tbai_enabled) {
                let mapped_included_taxes = [];
                let product = this.get_product();
                let price_unit;
                let tax = this.get_taxes()[0];
                json.tbai_description = product.display_name || "";
                if (tax) {
                    json.tbai_vat_amount = tax.amount;
                    json.tbai_price_without_tax = this.get_price_without_tax();
                    json.tbai_price_with_tax = this.get_price_with_tax();
                    let fp_taxes = this._map_tax_fiscal_position(tax);
                    if (tax.price_include && _.contains(fp_taxes, tax)) {
                        mapped_included_taxes.push(tax);
                    }
                }
                if (mapped_included_taxes.length > 0) {
                    price_unit = this.compute_all(
                        mapped_included_taxes, json.price_unit, 1,
                        this.pos.currency.rounding, true).total_excluded;
                } else {
                    price_unit = json.price_unit;
                }
                json.tbai_price_unit = price_unit;
            }
            return json;
        },
    });

    models.Order = models.Order.extend({
        initialize: function () {
            this.tbai_simplified_invoice = null;
            this.tbai_current_invoice = $.when();
            order_super.initialize.apply(this, arguments);
            if (this.pos.company.tbai_enabled && "json" in arguments[1]) {
                this.tbai_simplified_invoice = new tbai_models.TicketBAISimplifiedInvoice(
                    {},
                    {
                        pos: this.pos,
                        tbai_identifier: arguments[1].json.tbai_identifier,
                        tbai_qr_src: arguments[1].json.tbai_qr_src,
                    }
                );
            }
            return this;
        },
        check_products_have_taxes: function () {
            let orderLines = this.get_orderlines();
            let line = null;
            let taxes = null;
            let all_products_have_one_tax = true;
            let i = 0;
            while (all_products_have_one_tax && i < orderLines.length) {
                line = orderLines[i];
                taxes = line.get_taxes();
                if (taxes.length !== 1) {
                    all_products_have_one_tax = false;
                }
                i++;
            }
            return all_products_have_one_tax;
        },
        check_company_vat: function () {
            return Boolean(this.pos.company.vat);
        },
        check_customer_country_code: function (client = null) {
            let customer = client || this.get_client();
            return !(!customer || (customer && !customer.country_id));
        },
        check_simplified_invoice_spanish_customer: function (client = null) {
            let customer = client || this.get_client();
            let ok = true;
            if (customer !== null) {
                ok = this.check_customer_country_code(customer);
                if (ok) {
                    let country_code = this.pos.get_country_code_by_id(
                        customer.country_id[0]
                    );
                    if (country_code !== "ES" && !this.to_invoice) {
                        ok = false;
                    }
                }
            }
            return ok;
        },
        check_customer_vat: function (client = null) {
            let customer = client || this.get_client();
            let ok = true;
            if (customer !== null) {
                ok = this.check_customer_country_code(customer);
                if (ok) {
                    let country_code = this.pos.get_country_code_by_id(
                        customer.country_id[0]
                    );
                    if (country_code === "ES") {
                        if (!customer.vat) {
                            ok = false;
                        }
                    } else if (customer.tbai_partner_idtype === "02" && !customer.vat) {
                        ok = false;
                    } else if (
                        customer.tbai_partner_idtype !== "02" &&
                        !customer.tbai_partner_identification_number
                    ) {
                        ok = false;
                    }
                }
            }
            return ok;
        },
        check_fiscal_position_vat_regime_key: function () {
            let ok = true;
            if (this.fiscal_position && !this.fiscal_position.tbai_vat_regime_key) {
                ok = false;
            }
            return ok;
        },
        check_tbai_conf: function() {
            return this.check_company_vat() &&
                this.check_simplified_invoice_spanish_customer() &&
                this.check_customer_vat() &&
                this.check_fiscal_position_vat_regime_key() &&
                this.check_products_have_taxes();
        },
        init_from_JSON: function (json) {
            order_super.init_from_JSON.apply(this, arguments);
            this.returned_order_to_invoice = json.returned_order_to_invoice;
        },
        export_as_JSON: function () {
            let datas;
            let signature_value;
            let tbai_inv;
            let json = order_super.export_as_JSON.apply(this, arguments);
            if (this.pos.company.tbai_enabled) {
                let taxLines = [];
                let order = this;
                this.get_tax_details().forEach(function (taxDetail) {
                    let taxLineDict = taxDetail;
                    taxLineDict.baseAmount = order.get_base_by_tax()[taxDetail.tax.id];
                    taxLines.push([0, 0, taxLineDict]);});
                json.taxLines = taxLines;
                tbai_inv = this.tbai_simplified_invoice || null;
                if (tbai_inv !== null) {
                    datas = tbai_inv.datas;
                    signature_value = tbai_inv.signature_value;
                    if (datas !== null && signature_value !== null) {
                        json.tbai_signature_value = signature_value;
                        json.tbai_datas = datas;
                        json.tbai_vat_regime_key = tbai_inv.vat_regime_key;
                        json.tbai_identifier = tbai_inv.tbai_identifier;
                        json.tbai_qr_src = tbai_inv.tbai_qr_src;
                        if (tbai_inv.previous_tbai_invoice !== null) {
                            json.tbai_previous_order_pos_reference =
                                tbai_inv.previous_tbai_invoice.order.simplified_invoice;
                        }
                    }
                }
            }
            return json;
        },
        export_for_printing: function () {
            let receipt = order_super.export_for_printing.apply(this, arguments);
            if (this.pos.company.tbai_enabled) {
                let tbai_inv = this.tbai_simplified_invoice || null;
                if (tbai_inv !== null) {
                    receipt.tbai_identifier = tbai_inv.tbai_identifier;
                    receipt.tbai_qr_src = tbai_inv.tbai_qr_src;
                }
            }
            return receipt;
        },
        tbai_build_invoice: function () {
            let self = this;
            if (self.tbai_current_invoice.state() === "rejected") {
                self.tbai_current_invoice = new $.when();
            }
            self.tbai_current_invoice = self.tbai_current_invoice.then(function () {
                let tbai_current_invoice = $.when();
                let tbai_inv = null;
                let ok = self.check_tbai_conf();
                if (ok && self.is_simplified_invoice && !self.to_invoice) {
                    tbai_inv = new tbai_models.TicketBAISimplifiedInvoice({}, {
                            pos: self.pos, order: self,
                    });
                    tbai_current_invoice = tbai_inv.build_invoice().then(function () {
                        return tbai_inv;
                    });
                }
                return tbai_current_invoice;
            });
        },
    });
});
