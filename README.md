Private custom node manager for ComfyUI  
It does not depend on the comfi management. There's a full paragraph there now - the latest versions haven't been shown for months (even for tops like rgthree, easy-use, pixorama, etc.). Tightening security checks cuts off updates to node versions through the comfi's in-house manager.  

The extension scans all the nodes in the custom_nodes folder.  
The extension works from Settings (the gear icon in the comfi sidebar).  
On the first scan, it collects data for all custom nodes (github versions, descriptions, release commits, etc.).  
Each time the comfi server is started, it uploads changes to the github.  
When calling the extension from Settings => Manager nodes, it will show a list of all nodes from custom_nodes and suggest:  
Install a node with dependencies using the github URL  
Update the installed node to the selected version  
Install (overwrite) a specific version of the node instead of the existing one  
Delete node - complete removal of the node folder from custom  
