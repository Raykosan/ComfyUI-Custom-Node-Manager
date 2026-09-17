Private custom node manager for ComfyUI  
It does not depend on the comfi management. It's a complete mess now - the latest versions haven't been shown for months (even for tops like rgthree, easy-use, pixorama, etc.). Tightening security checks cuts off updates to node versions through the comfi's in-house manager.  

The extension scans all the nodes in the custom_nodes folder.  
The extension works from Settings (the gear icon in the comfi sidebar).  
On the first scan, it collects data for all custom nodes (github versions, descriptions, release commits, etc.).  
Each time the comfi server is started, it uploads changes to the github.  
When calling the extension from Settings => Manager nodes, it will show a list of all nodes from custom_nodes and suggest:  
Install a node with dependencies using the github URL  
Update the installed node to the selected version  
Install (overwrite) a specific version of the node instead of the existing one  
Delete node - complete removal of the node folder from custom  

Many node developers do not specify versions. Just click 'Latest' and you will have the latest version of the node available on the github.  

<img width="217" height="765" alt="Screenshot_1" src="https://github.com/user-attachments/assets/b3bb8b71-c7a4-4f5e-a8c6-6c28e1f71789" />
<img width="248" height="104" alt="Screenshot_2" src="https://github.com/user-attachments/assets/a023e9c9-46d0-465f-a6ae-1423c95be448" />
<img width="890" height="870" alt="Screenshot_3" src="https://github.com/user-attachments/assets/7c2342c3-6029-44ed-8401-f63b79b07ede" />
<img width="511" height="302" alt="Screenshot_5" src="https://github.com/user-attachments/assets/6a48f70a-be40-41f5-8565-946c0b5a479b" />



